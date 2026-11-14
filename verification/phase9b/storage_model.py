#!/usr/bin/env python3
"""Offline sizing model only. Does not access Docker, registries or databases.
Inputs are public manifest sizes and HTTP Range gzip-footer metadata, not an exact
measurement of a fully unpacked Supabase image. Read the report's caveats.
"""
import json
from pathlib import Path


def cumulative_copy_bytes(layer_sizes):
    if any(type(n) is not int or n < 0 or n >= 2**32 for n in layer_sizes):
        raise ValueError('Expected nonnegative 32-bit gzip ISIZE values')
    return sum(n * (len(layer_sizes)-index) for index,n in enumerate(layer_sizes))


def summarize(record):
    rows=[]
    for image in record['images']:
        sizes=image['uncompressed_tar_isize_bytes']
        if len(sizes)!=len(image['compressed_layer_bytes']):
            raise ValueError('Layer count mismatch')
        rows.append({'image':image['image'],'layers':len(sizes),
                     'compressed_bytes':sum(image['compressed_layer_bytes']),
                     'tar_bytes':sum(sizes),
                     'vfs_no_deletion_estimate_bytes':cumulative_copy_bytes(sizes)})
    return rows


if __name__=='__main__':
    record=json.loads(Path(__file__).with_name('storage-diagnostics.json').read_text())
    for row in summarize(record):
        print(f"{row['image']}: {row['layers']} layers; "
              f"compressed {row['compressed_bytes']/2**30:.3f} GiB; "
              f"tar {row['tar_bytes']/2**30:.3f} GiB; "
              f"VFS model {row['vfs_no_deletion_estimate_bytes']/2**30:.3f} GiB")
