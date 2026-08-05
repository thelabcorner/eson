#ifndef ESON_EXTERNALOBJECT_ABI_H
#define ESON_EXTERNALOBJECT_ABI_H

#ifdef _WIN32
#define EO_EXPORT __declspec(dllexport)
#else
#define EO_EXPORT __attribute__((visibility("default")))
#endif

#include <stdint.h>

/*
 * Adobe ExtendScript ExternalObject direct-access ABI, reconstructed from the
 * Adobe JavaScript Tools Guide and validated by the chunkdb POC on
 * Illustrator 30.6.0. Call order: (argv, argc, result).
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
    kTypeString = 1,
    kTypeBool = 2,
    kTypeDouble = 3,
    kTypeInteger = 4,
    kTypeUInteger = 5,
    kTypeLiveObject = 6,
    kTypeLiveObjectRelease = 7,
    kTypeScript = 8
};

typedef void (*ExternalObjectFunction)(TaggedData *argv, intptr_t argc, TaggedData *result);

#endif
