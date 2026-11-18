import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('build', Path(__file__).with_name('build-offline-android.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

class BuildTests(unittest.TestCase):
    def test_wrapper_timeout_and_official_host_preserve_version_and_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'gradle-wrapper.properties'
            original='distributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip\nnetworkTimeout=10000\ndistributionSha256Sum=trusted-checksum\n'
            path.write_text(original)
            build.configure_wrapper(path,120000,True)
            build.configure_wrapper(path,180000,True)
            value=path.read_text()
            self.assertIn('downloads.gradle.org/distributions/gradle-9.4.1-bin.zip',value)
            self.assertIn('distributionSha256Sum=trusted-checksum',value)
            self.assertEqual(value.count('networkTimeout='),1)
            self.assertIn('networkTimeout=180000',value)

    def test_download_timeout_retried_then_succeeds(self):
        calls=[]
        def run(cmd,**kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd,1,'java.net.SocketTimeoutException') if len(calls)==1 else subprocess.CompletedProcess(cmd,0,'Gradle ready')
        self.assertTrue(build.bootstrap_wrapper(Path('/unused'),{},3,run=run,pause=lambda _:None))
        self.assertEqual(calls,[['./gradlew','--version']]*2)

    def test_non_network_error_not_retried(self):
        calls=[]
        def run(cmd,**kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd,1,'Invalid JAVA_HOME')
        self.assertFalse(build.bootstrap_wrapper(Path('/unused'),{},3,run=run,pause=lambda _:None))
        self.assertEqual(len(calls),1)

    def test_retries_are_bounded(self):
        calls=[]
        def run(cmd,**kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd,1,'Downloading from URL failed')
        self.assertFalse(build.bootstrap_wrapper(Path('/unused'),{},2,run=run,pause=lambda _:None))
        self.assertEqual(len(calls),2)

if __name__=='__main__':unittest.main()
