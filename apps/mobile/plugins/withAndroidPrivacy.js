const {withMainActivity}=require('@expo/config-plugins');
module.exports=config=>withMainActivity(config,c=>{if(!c.modResults.contents.includes('FLAG_SECURE'))c.modResults.contents=c.modResults.contents.replace('super.onCreate(null)','window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)\n    super.onCreate(null)');return c;});
