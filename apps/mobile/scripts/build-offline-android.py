"""Build a signed, offline-only ARM64 APK without Play Store or cloud services."""
import argparse,json,os,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--keystore',required=True);p.add_argument('--credentials',required=True);args=p.parse_args()
project=Path(__file__).resolve().parents[1]
credentials=Path(args.credentials).resolve();keystore=Path(args.keystore).resolve()
if not credentials.is_file() or not keystore.is_file():p.error('Signing files do not exist.')
data=json.loads(credentials.read_text())
if data.get('alias')!='feeflow' or not data.get('storePassword'):p.error('Expected alias feeflow and storePassword in credentials JSON.')
env=dict(os.environ,APP_VARIANT='production',FEEFLOW_KEYSTORE=str(keystore),FEEFLOW_STORE_PASSWORD=data['storePassword'],EXPO_NO_TELEMETRY='1')
subprocess.run(['npx','expo','prebuild','--platform','android','--no-install'],cwd=project,env=env,check=True)
subprocess.run(['./gradlew',':app:assembleRelease','--no-daemon','--max-workers=2','-PreactNativeArchitectures=arm64-v8a'],cwd=project/'android',env=env,check=True)
print('Signed APK:',project/'android/app/build/outputs/apk/release/app-release.apk')
