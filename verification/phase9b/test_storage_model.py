import json
from pathlib import Path
import unittest
from storage_model import cumulative_copy_bytes,summarize


class StorageSizingTests(unittest.TestCase):
    def test_cumulative_layer_copies(self):
        self.assertEqual(cumulative_copy_bytes([10,20,30]),10+30+60)

    def test_empty_and_zero_layers(self):
        self.assertEqual(cumulative_copy_bytes([]),0)
        self.assertEqual(cumulative_copy_bytes([0,0]),0)

    def test_reject_invalid_or_wrapped_claims(self):
        for value in [-1,2**32,1.1,True]:
            with self.assertRaises(ValueError):cumulative_copy_bytes([value])

    def test_layer_mismatch_rejected(self):
        with self.assertRaises(ValueError):
            summarize({'images':[{'uncompressed_tar_isize_bytes':[1],'compressed_layer_bytes':[]}]})

    def test_recorded_sizes_reproduce(self):
        data=json.loads(Path(__file__).with_name('storage-diagnostics.json').read_text())
        for row,source in zip(summarize(data),data['images']):
            self.assertEqual(row['compressed_bytes'],source['compressed_total_bytes'])
            self.assertEqual(row['tar_bytes'],source['tar_total_bytes'])
            self.assertEqual(row['vfs_no_deletion_estimate_bytes'],source['vfs_no_deletion_estimate_bytes'])
        self.assertGreater(data['core_totals']['vfs_no_deletion_estimate_bytes'],data['backing_probe']['total_bytes'])


if __name__=='__main__':unittest.main()
