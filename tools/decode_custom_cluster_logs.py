#!/usr/bin/env python3
"""Decode all CCLOG1 QR text pages copied from the phone into a text file.

Usage: python3 tools/decode_custom_cluster_logs.py scanned-pages.txt
Multiple pages may be in any order. The output is printed to stdout.
"""
import base64
import re
import sys
import zlib

PATTERN = re.compile(r"CCLOG1\s+([a-f0-9]{10})\s+(\d+)/(\d+)\s+([A-Za-z0-9+/=]+)")


def decode(value):
    matches = PATTERN.findall(value)
    if not matches:
        raise ValueError("No CCLOG1 pages found")
    report_id, total = matches[0][0], int(matches[0][2])
    parts = {}
    for found_id, idx, count, data in matches:
        if found_id != report_id or int(count) != total:
            raise ValueError("Mixed report IDs or page counts")
        index = int(idx)
        if not 1 <= index <= total:
            raise ValueError("Invalid page index")
        if index in parts and parts[index] != data:
            raise ValueError("Conflicting duplicate QR page")
        parts[index] = data
    missing = [index for index in range(1, total + 1) if index not in parts]
    if missing:
        raise ValueError("Missing QR pages: " + ", ".join(map(str, missing)))
    return zlib.decompress(base64.b64decode("".join(parts[i] for i in range(1, total + 1)))).decode("utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: decode_custom_cluster_logs.py scanned-pages.txt")
    with open(sys.argv[1], encoding="utf-8") as source:
        print(decode(source.read()), end="")
