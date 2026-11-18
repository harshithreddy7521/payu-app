"""Build a signed, offline-only ARM64 APK without Play Store or cloud services."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time


def configure_wrapper(path, timeout_ms, direct_download=False):
    """Apply AFTER prebuild, which may regenerate the wrapper properties."""
    contents = path.read_text()
    if direct_download:
        contents = contents.replace('services.gradle.org/distributions/',
                                    'downloads.gradle.org/distributions/')
    contents = re.sub(r'^networkTimeout=.*(?:\n|$)', '', contents, flags=re.MULTILINE)
    path.write_text(contents.rstrip() + f'\nnetworkTimeout={timeout_ms}\n')


def bootstrap_wrapper(project, env, attempts, run=subprocess.run, pause=time.sleep):
    """Retry only distribution bootstrap, never native compilation/signing."""
    for attempt in range(1, attempts + 1):
        result = run(['./gradlew', '--version'], cwd=project / 'android', env=env,
                     text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        print(result.stdout or '', end='', flush=True)
        if result.returncode == 0:
            return True
        output = result.stdout or ''
        download_failure = any(marker in output for marker in (
            'SocketTimeoutException', 'UnknownHostException',
            'ConnectException', 'Downloading from', 'Could not install Gradle distribution'))
        if not download_failure or attempt == attempts:
            return False
        print(f'Gradle download failed; retrying ({attempt + 1}/{attempts})...', flush=True)
        pause(min(attempt * 3, 10))
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keystore', required=True)
    parser.add_argument('--credentials', required=True)
    parser.add_argument('--gradle-download-timeout', type=int, default=120000,
                        help='Distribution connection/read timeout in milliseconds (default 120000)')
    parser.add_argument('--gradle-download-attempts', type=int, default=3)
    parser.add_argument('--gradle-direct-download', action='store_true',
                        help='Use official downloads.gradle.org instead of services.gradle.org redirects')
    args = parser.parse_args()
    if not 1000 <= args.gradle_download_timeout <= 600000:
        parser.error('Download timeout must be between 1000 and 600000 milliseconds.')
    if not 1 <= args.gradle_download_attempts <= 5:
        parser.error('Download attempts must be between 1 and 5.')
    project = Path(__file__).resolve().parents[1]
    credentials = Path(args.credentials).expanduser().resolve()
    keystore = Path(args.keystore).expanduser().resolve()
    if not credentials.is_file() or not keystore.is_file():
        parser.error('Signing files do not exist.')
    try:
        data = json.loads(credentials.read_text())
    except (ValueError, OSError):
        parser.error('Cannot read signing credentials JSON.')
    if data.get('alias') != 'feeflow' or not isinstance(data.get('storePassword'), str) or not data['storePassword']:
        parser.error('Expected alias feeflow and storePassword in credentials JSON.')
    env = dict(os.environ, APP_VARIANT='production', FEEFLOW_KEYSTORE=str(keystore),
               FEEFLOW_STORE_PASSWORD=data['storePassword'], EXPO_NO_TELEMETRY='1')
    try:
        subprocess.run(['npx', 'expo', 'prebuild', '--platform', 'android', '--no-install'],
                       cwd=project, env=env, check=True)
        configure_wrapper(project / 'android/gradle/wrapper/gradle-wrapper.properties',
                          args.gradle_download_timeout, args.gradle_direct_download)
        if not bootstrap_wrapper(project, env, args.gradle_download_attempts):
            print('\nGradle could not start. Check the download error above. If it is a network timeout, '
                  'try --gradle-direct-download or another network. Your signing files were not changed.', file=sys.stderr)
            return 1
        subprocess.run(['./gradlew', ':app:assembleRelease', '--no-daemon', '--max-workers=2',
                        '-PreactNativeArchitectures=arm64-v8a'], cwd=project / 'android', env=env, check=True)
    except subprocess.CalledProcessError:
        print('\nBuild failed. See the command output above; no successful APK is being reported.', file=sys.stderr)
        return 1
    print('Signed APK:', project / 'android/app/build/outputs/apk/release/app-release.apk')
    return 0


if __name__ == '__main__':
    sys.exit(main())
