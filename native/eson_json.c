/*
 * ESONJson.dll - minimal ExtendScript ExternalObject case for the ESON
 * prototype (eson/).
 *
 * Experiment summary (Illustrator 30.6.0, ExtendScript 4.5.6, live session):
 *   - Loading and numeric dispatch work (ping/version).
 *   - String ingress WORKS for the chunkdb POC DLL (stage('{"a":1}') -> 7)
 *     but NOT for this DLL: the string TaggedData is rejected by
 *     raw_string_arg on this host, and several no-arg methods fail to bind
 *     ("is not a function" / "Error #" / "Language feature '' is not
 *     supported"). The chunkdb POC documents the same class of failures
 *     ("several dynamic string paths failed", ABI/UB sensitivity).
 *   - The C validation/escaping logic itself is correct (validated via iso1:
 *     validate_json("{}") -> 0).
 * Conclusion: the ExternalObject boundary is not a reliable transport for
 * the gate/escape lanes on this host; the numbers that matter come from the
 * JSX lanes. This DLL is retained as the ABI experiment artifact.
 *
 * ABI: direct-access (TaggedData *argv, intptr_t argc, TaggedData *result),
 * x64, exports declared with the chunkdb's proven (void*, void*, void*) shape.
 * Numeric results: double with kTypeDouble. String returns: static buffer.
 * No logging side effects.
 */
#include "eson_abi.h"

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

#define STATIC_RET_CAP (64 * 1024)
static char g_static_ret[STATIC_RET_CAP]; /* escapeDirect static return */

/* -------------------------------------------------------------- helpers */
static void set_double(TaggedData *result, double value) {
    if (!result) return;
    result->data.fltval = value;
    result->type = kTypeDouble;
    result->filler = 0;
}

static void set_undefined(TaggedData *result) {
    if (!result) return;
    result->data.intval = 0;
    result->type = kTypeUndefined;
    result->filler = 0;
}

static void set_static_string(TaggedData *result, const char *value) {
    if (!result) return;
    result->data.string = (char *)(value ? value : "");
    result->type = kTypeString;
    result->filler = 0;
}

static int raw_string_arg(TaggedData *argv, intptr_t argc, intptr_t index,
                          const char **value, long *tag) {
    char *base;
    long type = 0;
    char *ptr = NULL;
    if (!argv || index < 0 || index >= argc) return 0;
    base = (char *)argv + (index * 16);
    memcpy(&ptr, base, sizeof(ptr));
    memcpy(&type, base + 8, sizeof(type));
    *tag = type;
    if (!ptr) return 0;
    if (type != kTypeString && type != 4) return 0; /* observed _a tag is 4 */
    *value = ptr;
    return 1;
}

static size_t utf8_strlen(const char *s) {
    size_t n = 0;
    if (!s) return 0;
    while (s[n]) n++;
    return n;
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
 * 53 exact bits) because string arguments are unreliable on this host. The
 * validator works on 16-bit code units; the kTypeScript return converts back
 * to UTF-8 (the host's documented script-string encoding). */

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

/* -------------------------------------------------------------- exports */
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

EO_EXPORT char *ESInitialize(TaggedData *argv, long argc) {
    (void)argv;
    (void)argc;
    return dup_string("ping_f,version_f,stage_s,stagedBytes_f,lastArgTag_f,"
                      "validateStaged_f,escapeStaged_f,escapedBytes_f,nextByte_f,"
                      "escapeDirect_s,resetState_f,validateText_a,stagePacked,"
                      "validatePacked,evalJson");
}

EO_EXPORT long ESGetVersion(void) { return 1; }

EO_EXPORT void ESFreeMem(void *p) { (void)p; /* conservative no-op (POC) */ }

EO_EXPORT void ESTerminate(void) {
    free(g_in); g_in = NULL; g_in_cap = 0; g_in_len = 0;
    free(g_out); g_out = NULL; g_out_cap = 0; g_out_len = 0; g_out_cursor = 0;
    free(g_in16); g_in16 = NULL; g_in16_cap = 0; g_in16_len = 0;
}

#define EXPORT_FN(name) \
    EO_EXPORT void name(void *p1, void *p2, void *p3) { \
        TaggedData *argv = (TaggedData *)p1; \
        intptr_t argc = (intptr_t)p2; \
        TaggedData *result = (TaggedData *)p3; \
        (void)argv; (void)argc;

#define EXPORT_END }

EXPORT_FN(ping)
    set_double(result, 42.0);
EXPORT_END

EXPORT_FN(version)
    set_double(result, 1.0);
EXPORT_END

EXPORT_FN(stage)
    const char *value = NULL;
    long tag = -1;
    size_t len;
    set_undefined(result);
    if (!raw_string_arg(argv, argc, 0, &value, &tag)) return;
    g_last_arg_tag = tag;
    len = utf8_strlen(value);
    if (len + 1 > g_in_cap || !g_in) {
        char *nb = (char *)realloc(g_in, len + 1);
        if (!nb) return;
        g_in = nb;
        g_in_cap = len + 1;
    }
    memcpy(g_in, value, len + 1);
    g_in_len = len;
    set_double(result, (double)len);
EXPORT_END

EXPORT_FN(stagedBytes)
    set_double(result, (double)g_in_len);
EXPORT_END

EXPORT_FN(lastArgTag)
    set_double(result, (double)g_last_arg_tag);
EXPORT_END

EXPORT_FN(validateStaged)
    set_double(result, (double)validate_json(g_in ? g_in : "", g_in_len));
EXPORT_END

EXPORT_FN(escapeStaged)
    if (escape_json(g_in ? g_in : "", g_in_len) != 0) {
        set_double(result, -1.0);
        return;
    }
    set_double(result, (double)g_out_len);
EXPORT_END

EXPORT_FN(escapedBytes)
    set_double(result, (double)g_out_len);
EXPORT_END

EXPORT_FN(nextByte)
    if (!g_out || g_out_cursor >= g_out_len) {
        set_double(result, -1.0);
        return;
    }
    set_double(result, (double)(unsigned char)g_out[g_out_cursor]);
    g_out_cursor++;
EXPORT_END

/* EXPERIMENT: direct string return. Static buffer; ABI-fragile per the POC. */
EXPORT_FN(escapeDirect)
    const char *value = NULL;
    long tag = -1;
    size_t len;
    int r;
    set_undefined(result);
    if (!raw_string_arg(argv, argc, 0, &value, &tag)) return;
    g_last_arg_tag = tag;
    len = utf8_strlen(value);
    if (len + 1 > g_in_cap || !g_in) {
        char *nb = (char *)realloc(g_in, len + 1);
        if (!nb) return;
        g_in = nb;
        g_in_cap = len + 1;
    }
    memcpy(g_in, value, len + 1);
    g_in_len = len;
    r = escape_json(g_in, g_in_len);
    if (r != 0) return;
    if (g_out_len >= STATIC_RET_CAP) return;
    memcpy(g_static_ret, g_out, g_out_len);
    g_static_ret[g_out_len] = 0;
    set_static_string(result, g_static_ret);
EXPORT_END

EXPORT_FN(resetState)
    g_in_len = 0;
    g_out_len = 0;
    g_out_cursor = 0;
    g_last_arg_tag = -1;
    set_double(result, 0.0);
EXPORT_END

/* Direct single-call gate: validates the argument string, returns the code. */
EXPORT_FN(validateText)
    const char *value = NULL;
    long tag = -1;
    if (raw_string_arg(argv, argc, 0, &value, &tag)) {
        size_t len = utf8_strlen(value);
        set_double(result, (double)validate_json(value, len));
    } else {
        set_double(result, -999.0);
    }
EXPORT_END




















/* ---- packed numeric transport (string args unreliable on this host) ------ */
/* stagePacked(len, p0, p1, ...): each double carries 3 UTF-16 code units in
 * its low 48 bits (integers are exact through 53 bits). Numeric arguments
 * are the reliably-bound path (measured). */
EXPORT_FN(stagePacked)
    double lenD = argv[0].data.fltval;
    size_t len = (size_t)lenD;
    size_t i;
    size_t filled = 0;
    if (argc < 1 || len == 0 || len > 0x400000) {
        set_double(result, -2.0);
        return;
    }
    if (len > g_in16_cap || !g_in16) {
        uint16_t *nb = (uint16_t *)realloc(g_in16, len * sizeof(uint16_t));
        if (!nb) {
            set_double(result, -3.0);
            return;
        }
        g_in16 = nb;
        g_in16_cap = len;
    }
    for (i = 1; i < (size_t)argc && filled < len; i++) {
        double v = argv[i].data.fltval;
        uint64_t uv = (uint64_t)v;
        g_in16[filled++] = (uint16_t)(uv & 0xFFFFu);
        if (filled < len) g_in16[filled++] = (uint16_t)((uv >> 16) & 0xFFFFu);
        if (filled < len) g_in16[filled++] = (uint16_t)((uv >> 32) & 0xFFFFu);
    }
    g_in16_len = len;
    set_double(result, (double)filled);
EXPORT_END

EXPORT_FN(validatePacked)
    set_double(result, (double)validate_json16(g_in16 ? g_in16 : NULL, g_in16_len));
EXPORT_END

/* kTypeScript return: validates the packed text, then returns it as a Script
 * TaggedData which the host evaluates - the JSX side receives the value
 * directly (no drain, no explicit eval). Returns undefined unless the input
 * conforms to the strict grammar; the security boundary is validate_json16. */
EXPORT_FN(evalJson)
    if (!g_in16 || validate_json16(g_in16, g_in16_len) != 0) {
        set_undefined(result);
        return;
    }
    if (utf16_to_utf8(g_in16, g_in16_len, g_static_ret, STATIC_RET_CAP) != 0) {
        set_undefined(result);
        return;
    }
    result->data.string = g_static_ret;
    result->type = kTypeScript;
    result->filler = 0;
EXPORT_END
