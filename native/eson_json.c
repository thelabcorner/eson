/*
 * ESONJson.dll - ExtendScript ExternalObject case for the ESON prototype
 * (eson/), using pinned ESABI v0.3.0 as the ExternalObject ABI authority
 * (Windows LONG32 behavior measured live on Illustrator 30.6.0).
 *
 * ABI dataset (Illustrator 30.6.0, live sessions 2026-08-04..07):
 *   - The first ESONJson DLL used the POC's reconstructed tags
 *     (ESABI_TYPE_STRING=1, ESABI_TYPE_INTEGER=4, ESABI_TYPE_SCRIPT=8), a (void*,void*,void*)
 *     export shape, `_a` signatures and a no-op ESFreeMem. Its string
 *     methods (stage/validateStaged/escapedBytes/validateText) failed to
 *     bind in BOTH live sessions; only ping/version/escapeStaged/nextByte
 *     bound.
 *   - The verified prototype rebuilt with the canonical ABI bound every
 *     method: documented `long fn(esabi_value*, long, esabi_value*)`
 *     prototypes, `_s` signatures, malloc'd strings + real
 *     ESFreeMem(free), ESABI_TYPE_STRING=4 (verified to ~360 KB per direction),
 *     ESABI_TYPE_INTEGER=123, ESABI_TYPE_SCRIPT=125 (auto-eval verified live).
 *     Failure tracked the DLL build, not the session.
 *   - Measured channel winners (same host): packBytes/unpackBytes
 *     (2-bytes-per-char packed channel) = 1.75x per-unit reads, 3.7x
 *     per-unit writes; whole-workload-native transforms = 4,800-11,900x.
 *     ESABI_TYPE_SCRIPT chunking loses at every chunk size - not used here.
 *
 * This DLL therefore keeps the (correct, iso1-validated) C validator and
 * escaper, consumes ESABI for tags/prototypes/ownership, and
 * adds the verified packed channel + whole-workload-native transforms.
 * `stagePacked`/`validatePacked` remain as the numeric-argument fallback
 * (string arguments are per-DLL-build: probe before depending on them).
 *
 * Build:  powershell -File build.ps1 [-OutputName ESONJsonN]
 * Test:   probes/eson-benchmark.jsx (native.bindings) inside Illustrator.
 */
#include <esabi/esabi.h>

#include <stdlib.h>
#include <string.h>
#include <limits.h>

#define MAX_DEPTH 512

/* ------------------------------------------------------------------ state */
static char *g_in = NULL;      /* staged UTF-8 input buffer */
static size_t g_in_len = 0;    /* staged byte length */
static size_t g_in_cap = 0;

static char *g_out = NULL;     /* escaped output buffer */
static size_t g_out_len = 0;   /* escaped byte length */
static size_t g_out_cap = 0;
static size_t g_out_cursor = 0; /* nextByte drain cursor */

static uint16_t *g_in16 = NULL; /* packed UTF-16 input buffer */
static size_t g_in16_len = 0;
static size_t g_in16_cap = 0;

static long g_last_arg_tag = -1; /* ABI evidence: which tag the host used */

/* -------------------------------------------------------------- helpers */
static void clear_retval(esabi_value *retval) {
    esabi_value_set_undefined(retval);
}

static void set_double(esabi_value *result, double value) {
    esabi_value_set_double(result, value);
}

static void set_integer(esabi_value *result, long value) {
    esabi_value_set_i32(result, (esabi_i32)value);
}

/* ESABI_TYPE_STRING (4): the returned buffer must be malloc'd - ExtendScript
 * frees it via ESFreeMem (this DLL's ESFreeMem = free). */
static void set_string(esabi_value *result, char *value) {
    esabi_value_set_string(result, value ? value : (char *)"" );
}

static int string_arg(esabi_value *argv, long argc, long index,
                      const char **value, long *tag) {
    if (!argv || index < 0 || index >= argc) return 0;
    if (argv[index].type != ESABI_TYPE_STRING) return 0; /* _s signature cast */
    if (tag) *tag = argv[index].type;
    *value = argv[index].payload.string_value ? argv[index].payload.string_value : "";
    return 1;
}

static long arg_as_long(esabi_value *a) {
    if (a->type == ESABI_TYPE_DOUBLE) return (long)a->payload.double_value;
    if (a->type == ESABI_TYPE_INTEGER || a->type == ESABI_TYPE_UINTEGER) return a->payload.signed_value;
    return -1; /* invalid */
}

static char *dup_string(const char *s) {
    size_t len;
    char *out;
    if (!s) s = "";
    len = strlen(s);
    out = (char *)malloc(len + 1);
    if (!out) return NULL;
    memcpy(out, s, len + 1);
    return out;
}

/* --------------------------------------------------------- JSON validator */
static int validate_value(const char *s, size_t n, size_t *i, int depth);

static int is_ws(unsigned char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

static int is_digit(unsigned char c) { return c >= '0' && c <= '9'; }

static int is_hex(unsigned char c) {
    return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f');
}

static int validate_string(const char *s, size_t n, size_t *i) {
    size_t p = *i + 1;
    unsigned char c;
    int k;
    while (p < n) {
        c = (unsigned char)s[p];
        if (c == '"') { *i = p + 1; return 0; }
        if (c == '\\') {
            p++;
            if (p >= n) return -3;
            c = (unsigned char)s[p];
            p++;
            if (c == '"' || c == '\\' || c == '/' || c == 'b' || c == 'f' ||
                c == 'n' || c == 'r' || c == 't') {
                continue;
            }
            if (c == 'u') {
                for (k = 0; k < 4; k++) {
                    if (p >= n || !is_hex((unsigned char)s[p])) return -3;
                    p++;
                }
                continue;
            }
            return -3;
        }
        if (c < 0x20) return -2;
        p++;
    }
    return -2;
}

static int validate_number(const char *s, size_t n, size_t *i) {
    size_t p = *i;
    unsigned char c;
    int any = 0;
    if (p < n && s[p] == '-') p++;
    if (p >= n) return -4;
    c = (unsigned char)s[p];
    if (c == '0') {
        p++;
        if (p < n && is_digit((unsigned char)s[p])) return -4;
    } else if (c >= '1' && c <= '9') {
        while (p < n && is_digit((unsigned char)s[p])) p++;
    } else {
        return -4;
    }
    if (p < n && s[p] == '.') {
        p++;
        any = 0;
        while (p < n && is_digit((unsigned char)s[p])) { any = 1; p++; }
        if (!any) return -4;
    }
    if (p < n && (s[p] == 'e' || s[p] == 'E')) {
        p++;
        if (p < n && (s[p] == '+' || s[p] == '-')) p++;
        any = 0;
        while (p < n && is_digit((unsigned char)s[p])) { any = 1; p++; }
        if (!any) return -4;
    }
    *i = p;
    return 0;
}

static int validate_object(const char *s, size_t n, size_t *i, int depth) {
    size_t p = *i + 1;
    if (depth > MAX_DEPTH) return -5;
    while (p < n && is_ws((unsigned char)s[p])) p++;
    if (p >= n) return -7;
    if (s[p] == '}') { *i = p + 1; return 0; }
    for (;;) {
        while (p < n && is_ws((unsigned char)s[p])) p++;
        if (p >= n || s[p] != '"') return -1;
        if (validate_string(s, n, &p) != 0) return -2;
        while (p < n && is_ws((unsigned char)s[p])) p++;
        if (p >= n || s[p] != ':') return -1;
        p++;
        while (p < n && is_ws((unsigned char)s[p])) p++;
        if (validate_value(s, n, &p, depth + 1) != 0) return -1;
        while (p < n && is_ws((unsigned char)s[p])) p++;
        if (p >= n) return -7;
        if (s[p] == ',') { p++; continue; }
        if (s[p] == '}') { *i = p + 1; return 0; }
        return -1;
    }
}

static int validate_array(const char *s, size_t n, size_t *i, int depth) {
    size_t p = *i + 1;
    if (depth > MAX_DEPTH) return -5;
    while (p < n && is_ws((unsigned char)s[p])) p++;
    if (p >= n) return -7;
    if (s[p] == ']') { *i = p + 1; return 0; }
    for (;;) {
        while (p < n && is_ws((unsigned char)s[p])) p++;
        if (validate_value(s, n, &p, depth + 1) != 0) return -1;
        while (p < n && is_ws((unsigned char)s[p])) p++;
        if (p >= n) return -7;
        if (s[p] == ',') { p++; continue; }
        if (s[p] == ']') { *i = p + 1; return 0; }
        return -1;
    }
}

static int validate_value(const char *s, size_t n, size_t *i, int depth) {
    unsigned char c;
    if (*i >= n) return -7;
    c = (unsigned char)s[*i];
    if (c == '{') return validate_object(s, n, i, depth);
    if (c == '[') return validate_array(s, n, i, depth);
    if (c == '"') return validate_string(s, n, i);
    if (c == 't') { if (*i + 4 <= n && !memcmp(s + *i, "true", 4)) { *i += 4; return 0; } return -1; }
    if (c == 'f') { if (*i + 5 <= n && !memcmp(s + *i, "false", 5)) { *i += 5; return 0; } return -1; }
    if (c == 'n') { if (*i + 4 <= n && !memcmp(s + *i, "null", 4)) { *i += 4; return 0; } return -1; }
    if (c == '-' || is_digit(c)) return validate_number(s, n, i);
    return -1;
}

static int validate_json(const char *s, size_t n) {
    size_t i = 0;
    int r;
    while (i < n && is_ws((unsigned char)s[i])) i++;
    if (i >= n) return -7;
    r = validate_value(s, n, &i, 0);
    if (r != 0) return r;
    while (i < n && is_ws((unsigned char)s[i])) i++;
    return i == n ? 0 : -6;
}

/* ---------------------------------------------------------- JSON escaper */
static int is_escape_needed(unsigned int cp) {
    if (cp <= 0x1f) return 1;
    if (cp == 0x22 || cp == 0x5c) return 1;
    if (cp >= 0x7f && cp <= 0x9f) return 1;
    if (cp == 0x00ad) return 1;
    if (cp >= 0x0600 && cp <= 0x0604) return 1;
    if (cp == 0x070f) return 1;
    if (cp == 0x17b4 || cp == 0x17b5) return 1;
    if (cp >= 0x200c && cp <= 0x200f) return 1;
    if (cp >= 0x2028 && cp <= 0x202f) return 1;
    if (cp >= 0x2060 && cp <= 0x206f) return 1;
    if (cp == 0xfeff) return 1;
    if (cp >= 0xfff0 && cp <= 0xffff) return 1;
    return 0;
}

static void hex4(unsigned int cp, char *dst) {
    static const char *HEX = "0123456789abcdef";
    dst[0] = '\\'; dst[1] = 'u';
    dst[2] = HEX[(cp >> 12) & 0xf];
    dst[3] = HEX[(cp >> 8) & 0xf];
    dst[4] = HEX[(cp >> 4) & 0xf];
    dst[5] = HEX[cp & 0xf];
}

static unsigned int utf8_decode(const unsigned char *s, size_t n, size_t *p) {
    unsigned char b0 = s[*p];
    unsigned int cp;
    if (b0 < 0x80) { (*p)++; return b0; }
    if (b0 >= 0xc2 && b0 <= 0xdf && *p + 1 < n) {
        cp = ((unsigned int)(b0 & 0x1f) << 6) | (s[*p + 1] & 0x3f);
        *p += 2;
        return cp;
    }
    if (b0 >= 0xe0 && b0 <= 0xef && *p + 2 < n) {
        cp = ((unsigned int)(b0 & 0x0f) << 12) |
             ((unsigned int)(s[*p + 1] & 0x3f) << 6) |
             (s[*p + 2] & 0x3f);
        *p += 3;
        return cp;
    }
    if (b0 >= 0xf0 && b0 <= 0xf4 && *p + 3 < n) {
        cp = ((unsigned int)(b0 & 0x07) << 18) |
             ((unsigned int)(s[*p + 1] & 0x3f) << 12) |
             ((unsigned int)(s[*p + 2] & 0x3f) << 6) |
             (s[*p + 3] & 0x3f);
        *p += 4;
        return cp;
    }
    (*p)++;
    return b0;
}

static int escape_json(const char *s, size_t n) {
    size_t need = n * 6 + 1;
    size_t p = 0;
    size_t o = 0;
    unsigned char c;
    if (need > g_out_cap || !g_out) {
        char *nb = (char *)realloc(g_out, need);
        if (!nb) return -1;
        g_out = nb;
        g_out_cap = need;
    }
    while (p < n) {
        c = (unsigned char)s[p];
        if (c == '"') { g_out[o++] = '\\'; g_out[o++] = '"'; p++; continue; }
        if (c == '\\') { g_out[o++] = '\\'; g_out[o++] = '\\'; p++; continue; }
        if (c == '\b') { memcpy(g_out + o, "\\b", 2); o += 2; p++; continue; }
        if (c == '\t') { memcpy(g_out + o, "\\t", 2); o += 2; p++; continue; }
        if (c == '\n') { memcpy(g_out + o, "\\n", 2); o += 2; p++; continue; }
        if (c == '\f') { memcpy(g_out + o, "\\f", 2); o += 2; p++; continue; }
        if (c == '\r') { memcpy(g_out + o, "\\r", 2); o += 2; p++; continue; }
        if (c < 0x20) {
            char hx[6];
            hex4(c, hx);
            memcpy(g_out + o, hx, 6);
            o += 6;
            p++;
            continue;
        }
        if (c >= 0x80) {
            unsigned int cp = utf8_decode((const unsigned char *)s, n, &p);
            if (is_escape_needed(cp)) {
                char hx[6];
                hex4(cp, hx);
                memcpy(g_out + o, hx, 6);
                o += 6;
            } else {
                size_t start = p - (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);
                size_t len = p - start;
                memcpy(g_out + o, s + start, len);
                o += len;
            }
            continue;
        }
        g_out[o++] = (char)c;
        p++;
    }
    g_out[o] = 0;
    g_out_len = o;
    g_out_cursor = 0;
    return 0;
}

/* --------------------------------------------------------- UTF-16 variant */
/* The packed transport moves UTF-16 code units (3 per IEEE-754 double, 48 of
 * 53 exact bits) as the numeric-argument fallback when string args do not
 * bind on a given DLL build. The validator works on 16-bit code units. */

static int validate_value16(const uint16_t *s, size_t n, size_t *i, int depth);

static int is_ws16(uint16_t c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r';
}

static int is_digit16(uint16_t c) { return c >= '0' && c <= '9'; }

static int is_hex16(uint16_t c) {
    return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f');
}

static int validate_string16(const uint16_t *s, size_t n, size_t *i) {
    size_t p = *i + 1;
    uint16_t c;
    int k;
    while (p < n) {
        c = s[p];
        if (c == '"') { *i = p + 1; return 0; }
        if (c == '\\') {
            p++;
            if (p >= n) return -3;
            c = s[p];
            p++;
            if (c == '"' || c == '\\' || c == '/' || c == 'b' || c == 'f' ||
                c == 'n' || c == 'r' || c == 't') {
                continue;
            }
            if (c == 'u') {
                for (k = 0; k < 4; k++) {
                    if (p >= n || !is_hex16(s[p])) return -3;
                    p++;
                }
                continue;
            }
            return -3;
        }
        if (c < 0x20) return -2;
        p++;
    }
    return -2;
}

static int validate_number16(const uint16_t *s, size_t n, size_t *i) {
    size_t p = *i;
    uint16_t c;
    int any = 0;
    if (p < n && s[p] == '-') p++;
    if (p >= n) return -4;
    c = s[p];
    if (c == '0') {
        p++;
        if (p < n && is_digit16(s[p])) return -4;
    } else if (c >= '1' && c <= '9') {
        while (p < n && is_digit16(s[p])) p++;
    } else {
        return -4;
    }
    if (p < n && s[p] == '.') {
        p++;
        any = 0;
        while (p < n && is_digit16(s[p])) { any = 1; p++; }
        if (!any) return -4;
    }
    if (p < n && (s[p] == 'e' || s[p] == 'E')) {
        p++;
        if (p < n && (s[p] == '+' || s[p] == '-')) p++;
        any = 0;
        while (p < n && is_digit16(s[p])) { any = 1; p++; }
        if (!any) return -4;
    }
    *i = p;
    return 0;
}

static int validate_object16(const uint16_t *s, size_t n, size_t *i, int depth) {
    size_t p = *i + 1;
    uint16_t c;
    if (depth > MAX_DEPTH) return -5;
    while (p < n && is_ws16(s[p])) p++;
    if (p >= n) return -7;
    if (s[p] == '}') { *i = p + 1; return 0; }
    for (;;) {
        while (p < n && is_ws16(s[p])) p++;
        if (p >= n || s[p] != '"') return -1;
        if (validate_string16(s, n, &p) != 0) return -2;
        while (p < n && is_ws16(s[p])) p++;
        if (p >= n || s[p] != ':') return -1;
        p++;
        while (p < n && is_ws16(s[p])) p++;
        if (validate_value16(s, n, &p, depth + 1) != 0) return -1;
        while (p < n && is_ws16(s[p])) p++;
        if (p >= n) return -7;
        c = s[p];
        if (c == ',') { p++; continue; }
        if (c == '}') { *i = p + 1; return 0; }
        return -1;
    }
}

static int validate_array16(const uint16_t *s, size_t n, size_t *i, int depth) {
    size_t p = *i + 1;
    uint16_t c;
    if (depth > MAX_DEPTH) return -5;
    while (p < n && is_ws16(s[p])) p++;
    if (p >= n) return -7;
    if (s[p] == ']') { *i = p + 1; return 0; }
    for (;;) {
        while (p < n && is_ws16(s[p])) p++;
        if (validate_value16(s, n, &p, depth + 1) != 0) return -1;
        while (p < n && is_ws16(s[p])) p++;
        if (p >= n) return -7;
        c = s[p];
        if (c == ',') { p++; continue; }
        if (c == ']') { *i = p + 1; return 0; }
        return -1;
    }
}

static int validate_value16(const uint16_t *s, size_t n, size_t *i, int depth) {
    uint16_t c;
    if (*i >= n) return -7;
    c = s[*i];
    if (c == '{') return validate_object16(s, n, i, depth);
    if (c == '[') return validate_array16(s, n, i, depth);
    if (c == '"') return validate_string16(s, n, i);
    if (c == 't') { if (*i + 4 <= n && s[*i] == 't' && s[*i + 1] == 'r' && s[*i + 2] == 'u' && s[*i + 3] == 'e') { *i += 4; return 0; } return -1; }
    if (c == 'f') { if (*i + 5 <= n && s[*i] == 'f' && s[*i + 1] == 'a' && s[*i + 2] == 'l' && s[*i + 3] == 's' && s[*i + 4] == 'e') { *i += 5; return 0; } return -1; }
    if (c == 'n') { if (*i + 4 <= n && s[*i] == 'n' && s[*i + 1] == 'u' && s[*i + 2] == 'l' && s[*i + 3] == 'l') { *i += 4; return 0; } return -1; }
    if (c == '-' || is_digit16(c)) return validate_number16(s, n, i);
    return -1;
}

static int validate_json16(const uint16_t *s, size_t n) {
    size_t i = 0;
    int r;
    while (i < n && is_ws16(s[i])) i++;
    if (i >= n) return -7;
    r = validate_value16(s, n, &i, 0);
    if (r != 0) return r;
    while (i < n && is_ws16(s[i])) i++;
    return i == n ? 0 : -6;
}

/* UTF-16 -> UTF-8 (BMP + surrogate pairs; lone surrogates as CESU-8, which
 * round-trips through ExtendScript's parser). Returns 0 on success. */
static int utf16_to_utf8(const uint16_t *s, size_t n, char *out, size_t cap) {
    size_t o = 0;
    size_t i = 0;
    while (i < n) {
        uint16_t c = s[i];
        if (c < 0x80) {
            if (o + 1 >= cap) return -1;
            out[o++] = (char)c;
            i++;
        } else if (c < 0x800) {
            if (o + 2 >= cap) return -1;
            out[o++] = (char)(0xC0 | (c >> 6));
            out[o++] = (char)(0x80 | (c & 0x3F));
            i++;
        } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < n &&
                   s[i + 1] >= 0xDC00 && s[i + 1] <= 0xDFFF) {
            unsigned int cp = 0x10000 + (((unsigned int)(c - 0xD800)) << 10) + (s[i + 1] - 0xDC00);
            if (o + 4 >= cap) return -1;
            out[o++] = (char)(0xF0 | (cp >> 18));
            out[o++] = (char)(0x80 | ((cp >> 12) & 0x3F));
            out[o++] = (char)(0x80 | ((cp >> 6) & 0x3F));
            out[o++] = (char)(0x80 | (cp & 0x3F));
            i += 2;
        } else {
            if (o + 3 >= cap) return -1;
            out[o++] = (char)(0xE0 | (c >> 12));
            out[o++] = (char)(0x80 | ((c >> 6) & 0x3F));
            out[o++] = (char)(0x80 | (c & 0x3F));
            i++;
        }
    }
    out[o] = 0;
    return 0;
}

/* ------------------------------------------------- packed 2-bytes-per-char */
/* The verified bulk channel (Illustrator 30.6.0): each returned char packs
 * TWO input bytes (b0 | b1<<8), so JSX reads N units with N/2 charCodeAt
 * calls plus arithmetic (~1.75x) and writes with N/2 fromCharCode plus one
 * native unpack (~3.7x). Byte-oriented: pairs whose second byte is
 * 0xD8-0xDF would hit the UTF-8 surrogate window in the packed value -
 * ASCII/Latin-1 inputs are safe; arbitrary bytes travel as hex. */

static int pack_bytes(const unsigned char *in, size_t n, char **outp) {
    size_t outlen = (n + 1) / 2;
    size_t cap = outlen * 3 + 1; /* worst case: 3 UTF-8 bytes per packed char */
    size_t o = 0;
    size_t i;
    char *out;
    out = (char *)malloc(cap);
    if (!out) return -1;
    for (i = 0; i + 1 < n; i += 2) {
        unsigned v = (unsigned)in[i] | ((unsigned)in[i + 1] << 8);
        if (v < 0x80) {
            out[o++] = (char)v;
        } else if (v < 0x800) {
            out[o++] = (char)(0xC0 | (v >> 6));
            out[o++] = (char)(0x80 | (v & 0x3F));
        } else {
            out[o++] = (char)(0xE0 | (v >> 12));
            out[o++] = (char)(0x80 | ((v >> 6) & 0x3F));
            out[o++] = (char)(0x80 | (v & 0x3F));
        }
    }
    if (i < n) {
        unsigned v = (unsigned)in[i]; /* last odd byte: pack with high byte 0 */
        if (v < 0x80) {
            out[o++] = (char)v;
        } else {
            out[o++] = (char)(0xC0 | (v >> 6));
            out[o++] = (char)(0x80 | (v & 0x3F));
        }
    }
    out[o] = '\0';
    *outp = out;
    return 0;
}

static int unpack_bytes(const char *packed, size_t n, char **outp, size_t *outlenp) {
    const unsigned char *p = (const unsigned char *)packed;
    const unsigned char *end = p + n;
    size_t outcap;
    size_t o = 0;
    char *out;
    /* worst case: 2 output bytes per packed char */
    outcap = n * 2 + 1;
    out = (char *)malloc(outcap);
    if (!out) return -1;
    while (p < end) {
        unsigned char b0 = p[0];
        unsigned int cp;
        size_t used;
        if (b0 < 0x80) { cp = b0; used = 1; }
        else if (b0 >= 0xc2 && b0 <= 0xdf && p + 1 < end) { cp = ((b0 & 0x1f) << 6) | (p[1] & 0x3f); used = 2; }
        else if (b0 >= 0xe0 && b0 <= 0xef && p + 2 < end) { cp = ((b0 & 0x0f) << 12) | ((p[1] & 0x3f) << 6) | (p[2] & 0x3f); used = 3; }
        else { free(out); return -1; }
        p += used;
        out[o++] = (char)(cp & 0xFF);
        if (cp >= 0x100) out[o++] = (char)((cp >> 8) & 0xFF);
    }
    out[o] = '\0';
    *outp = out;
    if (outlenp) *outlenp = o;
    return 0;
}

/* ---------------------------------------------------- whole-native utils */
static const char hex_lower[] = "0123456789abcdef";

static int hex_encode(const char *in, size_t n, char **outp) {
    size_t i;
    char *out;
    out = (char *)malloc(n * 2 + 1);
    if (!out) return -1;
    for (i = 0; i < n; i++) {
        out[i * 2] = hex_lower[((unsigned char)in[i]) >> 4];
        out[i * 2 + 1] = hex_lower[((unsigned char)in[i]) & 0xF];
    }
    out[n * 2] = '\0';
    *outp = out;
    return 0;
}

static unsigned crc32_bytes(const unsigned char *p, size_t n) {
    static unsigned tab[256];
    static int tab_init = 0;
    size_t i;
    unsigned crc;
    if (!tab_init) {
        unsigned t;
        for (t = 0; t < 256; t++) {
            unsigned c = t;
            int k;
            for (k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
            }
            tab[t] = c;
        }
        tab_init = 1;
    }
    crc = 0xFFFFFFFFu;
    for (i = 0; i < n; i++) {
        crc = tab[(crc ^ p[i]) & 0xFF] ^ (crc >> 8);
    }
    return crc ^ 0xFFFFFFFFu;
}

/* ------------------------------------------------------------- exports */
/* Mandatory entry points. ESInitialize returns the signature string
 * (malloc'd - freed via ESFreeMem like any returned string). */
ESABI_INITIALIZE_FUNCTION {
    (void)argv;
    (void)argc;
    return dup_string("ping_f,version_f,stage_s,stagedBytes_f,validateStaged_f,"
                      "escapeStaged_f,escapedBytes_f,nextByte_f,escapeDirect_s,"
                      "resetState_f,validateText_s,packBytes_s,unpackBytes_s,"
                      "hexEncode_s,crc32_s,stagePacked,validatePacked,evalJson");
}

ESABI_VERSION_FUNCTION { return 1; }

ESABI_FREE_FUNCTION { free(pointer); }

ESABI_TERMINATE_FUNCTION {
    free(g_in); g_in = NULL; g_in_cap = 0; g_in_len = 0;
    free(g_out); g_out = NULL; g_out_cap = 0; g_out_len = 0; g_out_cursor = 0;
    free(g_in16); g_in16 = NULL; g_in16_cap = 0; g_in16_len = 0;
}

/* Direct methods use ESABI_DIRECT_FUNCTION(name), returning ESABI_OK (0)
 * or a non-negative catchable code. Never return
 * negative codes (fatal, uncatchable). */

ESABI_DIRECT_FUNCTION(ping) {
    (void)argv; (void)argc;
    clear_retval(retval);
    set_double(retval, 42.0);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(version) {
    (void)argv; (void)argc;
    clear_retval(retval);
    set_double(retval, 2.0); /* ABI-generation 2: canonical tags + long shape */
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(stage) {
    const char *value = NULL;
    long tag = -1;
    size_t len;
    clear_retval(retval);
    if (!string_arg(argv, argc, 0, &value, &tag)) return ESABI_ERR_BAD_ARGUMENTS;
    g_last_arg_tag = tag;
    len = strlen(value);
    if (len + 1 > g_in_cap || !g_in) {
        char *nb = (char *)realloc(g_in, len + 1);
        if (!nb) return ESABI_ERR_OUT_OF_MEMORY;
        g_in = nb;
        g_in_cap = len + 1;
    }
    memcpy(g_in, value, len + 1);
    g_in_len = len;
    set_double(retval, (double)len);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(stagedBytes) {
    (void)argv; (void)argc;
    clear_retval(retval);
    set_double(retval, (double)g_in_len);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(lastArgTag) {
    (void)argv; (void)argc;
    clear_retval(retval);
    set_double(retval, (double)g_last_arg_tag);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(validateStaged) {
    (void)argv; (void)argc;
    clear_retval(retval);
    set_double(retval, (double)validate_json(g_in ? g_in : "", g_in_len));
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(escapeStaged) {
    (void)argv; (void)argc;
    clear_retval(retval);
    if (escape_json(g_in ? g_in : "", g_in_len) != 0) {
        set_double(retval, -1.0);
        return ESABI_ERR_OUT_OF_MEMORY;
    }
    set_double(retval, (double)g_out_len);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(escapedBytes) {
    (void)argv; (void)argc;
    clear_retval(retval);
    set_double(retval, (double)g_out_len);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(nextByte) {
    (void)argv; (void)argc;
    clear_retval(retval);
    if (!g_out || g_out_cursor >= g_out_len) {
        set_double(retval, -1.0);
        return ESABI_OK;
    }
    set_double(retval, (double)(unsigned char)g_out[g_out_cursor]);
    g_out_cursor++;
    return ESABI_OK;
}

/* Single-call escape: string in, escaped string out (ESABI_TYPE_STRING=4,
 * malloc'd, freed by ESFreeMem). */
ESABI_DIRECT_FUNCTION(escapeDirect) {
    const char *value = NULL;
    long tag = -1;
    size_t len;
    char *out;
    clear_retval(retval);
    if (!string_arg(argv, argc, 0, &value, &tag)) return ESABI_ERR_BAD_ARGUMENTS;
    g_last_arg_tag = tag;
    len = strlen(value);
    if (len + 1 > g_in_cap || !g_in) {
        char *nb = (char *)realloc(g_in, len + 1);
        if (!nb) return ESABI_ERR_OUT_OF_MEMORY;
        g_in = nb;
        g_in_cap = len + 1;
    }
    memcpy(g_in, value, len + 1);
    g_in_len = len;
    if (escape_json(g_in, g_in_len) != 0) return ESABI_ERR_OUT_OF_MEMORY;
    out = (char *)malloc(g_out_len + 1);
    if (!out) return ESABI_ERR_OUT_OF_MEMORY;
    memcpy(out, g_out, g_out_len + 1);
    set_string(retval, out);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(resetState) {
    (void)argv; (void)argc;
    clear_retval(retval);
    g_in_len = 0;
    g_out_len = 0;
    g_out_cursor = 0;
    g_last_arg_tag = -1;
    set_double(retval, 0.0);
    return ESABI_OK;
}

/* Single-call strict JSON gate (the whole-workload-native replacement for
 * the JSX charCodeAt scanner): string in, verdict out (0 = valid). */
ESABI_DIRECT_FUNCTION(validateText) {
    const char *value = NULL;
    long tag = -1;
    clear_retval(retval);
    if (!string_arg(argv, argc, 0, &value, &tag)) {
        set_double(retval, -999.0); /* ABI evidence: arg did not arrive as string */
        return ESABI_OK;
    }
    g_last_arg_tag = tag;
    set_double(retval, (double)validate_json(value, strlen(value)));
    return ESABI_OK;
}

/* packBytes(s) -> packed 2-bytes-per-char string (the bulk charCodeAt
 * replacement; see pack_bytes comment for the surrogate-window caveat). */
ESABI_DIRECT_FUNCTION(packBytes) {
    const char *value = NULL;
    long tag = -1;
    char *out = NULL;
    clear_retval(retval);
    if (!string_arg(argv, argc, 0, &value, &tag)) return ESABI_ERR_BAD_ARGUMENTS;
    g_last_arg_tag = tag;
    if (pack_bytes((const unsigned char *)value, strlen(value), &out) != 0) {
        return ESABI_ERR_OUT_OF_MEMORY;
    }
    set_string(retval, out);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(unpackBytes) {
    const char *value = NULL;
    long tag = -1;
    char *out = NULL;
    clear_retval(retval);
    if (!string_arg(argv, argc, 0, &value, &tag)) return ESABI_ERR_BAD_ARGUMENTS;
    g_last_arg_tag = tag;
    if (unpack_bytes(value, strlen(value), &out, NULL) != 0) {
        return ESABI_ERR_BAD_ARGUMENTS; /* not valid packed data */
    }
    set_string(retval, out);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(hexEncode) {
    const char *value = NULL;
    long tag = -1;
    char *out = NULL;
    clear_retval(retval);
    if (!string_arg(argv, argc, 0, &value, &tag)) return ESABI_ERR_BAD_ARGUMENTS;
    g_last_arg_tag = tag;
    if (hex_encode(value, strlen(value), &out) != 0) return ESABI_ERR_OUT_OF_MEMORY;
    set_string(retval, out);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(crc32) {
    const char *value = NULL;
    long tag = -1;
    clear_retval(retval);
    if (!string_arg(argv, argc, 0, &value, &tag)) return ESABI_ERR_BAD_ARGUMENTS;
    g_last_arg_tag = tag;
    set_integer(retval, (long)crc32_bytes((const unsigned char *)value, strlen(value)));
    return ESABI_OK;
}

/* ---- packed numeric transport (fallback when string args do not bind) --- */
/* stagePacked(len, p0, p1, ...): each double carries 3 UTF-16 code units in
 * its low 48 bits (integers are exact through 53 bits). No declared
 * signature (variadic numeric arguments are the reliably-bound path). */
ESABI_DIRECT_FUNCTION(stagePacked) {
    double lenD;
    size_t len;
    size_t i;
    size_t filled = 0;
    clear_retval(retval);
    if (argc < 1) return ESABI_ERR_BAD_ARGUMENTS;
    lenD = argv[0].payload.double_value;
    len = (size_t)lenD;
    if (len == 0 || len > 0x400000) {
        set_double(retval, -2.0);
        return ESABI_OK;
    }
    if (len > g_in16_cap || !g_in16) {
        uint16_t *nb = (uint16_t *)realloc(g_in16, len * sizeof(uint16_t));
        if (!nb) {
            set_double(retval, -3.0);
            return ESABI_OK;
        }
        g_in16 = nb;
        g_in16_cap = len;
    }
    for (i = 1; i < (size_t)argc && filled < len; i++) {
        double v = argv[i].payload.double_value;
        uint64_t uv = (uint64_t)v;
        g_in16[filled++] = (uint16_t)(uv & 0xFFFFu);
        if (filled < len) g_in16[filled++] = (uint16_t)((uv >> 16) & 0xFFFFu);
        if (filled < len) g_in16[filled++] = (uint16_t)((uv >> 32) & 0xFFFFu);
    }
    g_in16_len = len;
    set_double(retval, (double)filled);
    return ESABI_OK;
}

ESABI_DIRECT_FUNCTION(validatePacked) {
    (void)argv; (void)argc;
    clear_retval(retval);
    set_double(retval, (double)validate_json16(g_in16 ? g_in16 : NULL, g_in16_len));
    return ESABI_OK;
}

/* ESABI_TYPE_SCRIPT (125) return: validates the packed text, then returns it as an
 * ESABI script value - the host evaluates it and returns the result (the
 * verified 2026-08-07 mechanism; the old reconstruction tag 8 never fired).
 * Security boundary preserved: only validate_json16-clean text is ever
 * returned as a script. Cost is superlinear in the host eval - keep payloads
 * small (~2-4 K units); do NOT build bulk-read pipelines on this. */
ESABI_DIRECT_FUNCTION(evalJson) {
    char *out;
    size_t cap;
    clear_retval(retval);
    (void)argv; (void)argc;
    if (!g_in16 || validate_json16(g_in16, g_in16_len) != 0) {
        return ESABI_OK; /* undefined */
    }
    cap = g_in16_len * 3 + 1; /* UTF-16 -> UTF-8 worst case */
    out = (char *)malloc(cap);
    if (!out) return ESABI_ERR_OUT_OF_MEMORY;
    if (utf16_to_utf8(g_in16, g_in16_len, out, cap) != 0) {
        free(out);
        return ESABI_OK; /* undefined */
    }
    esabi_value_set_script(retval, out);
    return ESABI_OK;
}
