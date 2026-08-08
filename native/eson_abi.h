#ifndef ESON_EXTERNALOBJECT_ABI_H
#define ESON_EXTERNALOBJECT_ABI_H

#ifdef _WIN32
#define EO_EXPORT __declspec(dllexport)
#else
#define EO_EXPORT __attribute__((visibility("default")))
#endif

#include <stdint.h>

/*
 * Adobe ExtendScript ExternalObject direct-access ABI.
 *
 * Canonical values from `SoSharedLibDefs.h`, confirmed at machine level
 * by decompiling AdobeXMPScript.dll (kTypeString=4, *(retval+1)=4) and
 * LIVE-verified on Illustrator 30.6.0 (2026-08-07):
 *
 *   kTypeUndefined   = 0    verified: stable "no value" return
 *   kTypeBool        = 2    documented (data.intval 0/1)
 *   kTypeDouble      = 3    verified: numeric returns
 *   kTypeString      = 4    verified end-to-end: UTF-8, malloc'd, freed via
 *                           ESFreeMem(free); type at offset +8
 *   kTypeLiveObject  = 6    indirect interface only
 *   kTypeLiveObjectRelease = 7
 *   kTypeInteger     = 123  verified: hash-style intval returns
 *   kTypeUInteger    = 124  verified: accepted as method input
 *   kTypeScript      = 125  verified live: host evaluates the returned
 *                           string as JavaScript and returns the result
 *
 * The EARLIER POC reconstruction (kTypeString=1, kTypeInteger=4,
 * kTypeScript=8) was wrong and is retired with this header.
 *
 * Error codes: kESErrOK = 0; non-negative codes surface as catchable
 * "Error #" with error.number == code (verified: kESErrBadArgumentList=20,
 * custom >= 10000). NEGATIVE codes (kESErrNoMemory=-28, kESErrException=-29,
 * kESErrInternal=-33) are FATAL - the JavaScript try/catch cannot contain
 * them. Never return a negative code from a method.
 */
typedef struct TaggedData TaggedData;

struct TaggedData {
    union {
        long intval;
        double fltval;
        char *string;
        void *hObject;
    } data;
    long type;
    long filler;
};

enum {
    kTypeUndefined = 0,
    kTypeBool = 2,
    kTypeDouble = 3,
    kTypeString = 4,
    kTypeLiveObject = 6,
    kTypeLiveObjectRelease = 7,
    kTypeInteger = 123,
    kTypeUInteger = 124,
    kTypeScript = 125
};

enum {
    kESErrOK = 0,
    kESErrBadArgumentList = 20,
    kESErrNoMemory = -28,
    kESErrException = -29,
    kESErrInternal = -33
};

/* Documented direct-interface call shape (ESFunction typedef in
 * SoSharedLibDefs.h; confirmed effective call order (argv, argc, retval)
 * on Illustrator 30.6.0). `long` return = error code, never negative. */
typedef long (*ExternalObjectFunction)(TaggedData *argv, long argc, TaggedData *retval);

#endif
