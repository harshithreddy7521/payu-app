const {withAppBuildGradle}=require('@expo/config-plugins');
module.exports=config=>withAppBuildGradle(config,c=>{
 const text=c.modResults.contents;
 if(text.includes('FEEFLOW_KEYSTORE'))return c;
 c.modResults.contents=text.replace('signingConfigs {',`signingConfigs {
        feeflowRelease {
            def path = System.getenv("FEEFLOW_KEYSTORE")
            if (path) storeFile file(path)
            storePassword System.getenv("FEEFLOW_STORE_PASSWORD")
            keyAlias "feeflow"
            keyPassword System.getenv("FEEFLOW_STORE_PASSWORD")
        }`).replace(/(release\s*\{[\s\S]*?)signingConfig signingConfigs.debug/, '$1signingConfig signingConfigs.feeflowRelease');
 return c;
});
