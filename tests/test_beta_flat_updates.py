import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from js_engine import evaluate

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('flat_builder', ROOT/'scripts/build_beta.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

def combined():
    return builder.beta_source()+'\n'+(ROOT/'src/update-policy.js').read_text(encoding='utf-8')+'\n'+builder.beta_updater_source()

class BetaFlatTests(unittest.TestCase):
    def test_no_glass_in_beta_payload(self):
        source=combined()
        for token in ('NSVisualEffectView','CIGaussianBlur','backgroundFilters','CAGradientLayer','betaDesignGlass','aboutGlassMode'):
            self.assertNotIn(token,source)
        self.assertIn('aboutCard(window.contentView',source)
        self.assertIn('function betaUpdatePresentation',source)

    def test_accent_presets_persistence_and_reading_preservation(self):
        body=(ROOT/'tests/app_harness.js').read_text(encoding='utf-8')+'\n'+combined()+r'''
check('palette persists and repaints without interrupting speech or altering text', function () {
    $.NSColor = {whiteColor: 'white', blackColor: 'black', disabledControlTextColor: 'disabled',
        colorWithSRGBRedGreenBlueAlpha: function (r,g,b,a) {return {rgb:[r,g,b],colorWithAlphaComponent:function () {return this;}};}};
    betaDesign.settings=null; betaExport.view=null;
    var button={tag:1001,enabled:true}, disabled={tag:1001,enabled:false};
    betaDesign.buttons=[button,disabled];
    active=true; paused=true; var speech=synth; var selection=ui.editor.selectedRange;
    ui.editor.string='Keep text';
    var presets=betaAccentPresets();
    assert(JSON.stringify(presets[0].rgb)==='[0,0.25098039215686274,1]');
    assert(JSON.stringify(presets[1].rgb)==='[0,1,0]');
    presets.forEach(function (preset) {
        betaAccentApply(preset.rgb); betaAccentRGB=[0,0,0]; betaAccentLoad();
        assert(JSON.stringify(betaAccentRGB)===JSON.stringify(preset.rgb));
        assert(button.needsDisplay && disabled.contentTintColor==='disabled');
    });
    betaAccentApply([0,1,0]); assert(button.contentTintColor==='black');
    betaAccentApply([0,64/255,1]); assert(button.contentTintColor==='white');
    betaAccentApply([0.2,0.4,0.6]); betaAccentLoad(); assert(betaAccentRGB[1]===0.4);
    var saved=defaults.objectForKey('betaAccentRGB'); betaAccentApply([3,0,0]); assert(defaults.objectForKey('betaAccentRGB')===saved);
    defaults.setObjectForKey('broken','betaAccentRGB'); betaAccentLoad(); assert(betaAccentRGB[1]===64/255);
    assert(active && paused && synth===speech && !speech.wasStopped && ui.editor.string==='Keep text' && ui.editor.selectedRange===selection);
});
'''
        result=json.loads(evaluate('(function () {\n'+body+'\nreturn JSON.stringify(testResults);\n}());'))
        for case in result:self.assertTrue(case['passed'],case.get('error'))

    def test_updater_core_and_window_actions(self):
        body=(ROOT/'tests/app_harness.js').read_text(encoding='utf-8')+'\n'+combined()+'\n'+(ROOT/'tests/update_cases.js').read_text(encoding='utf-8')
        body+=r'''
function updateViewFixture() {
    betaUpdateUI.confirming=false; betaUpdateUI.result='';
    betaDesign.buttons=[];betaDesign.settings=null;betaExport.view=null;
    $.NSColor={whiteColor:'white',blackColor:'black',disabledControlTextColor:'disabled'};
    var state={hidden:false,stopped:[],shows:0};
    betaUpdateUI.view={title:{},version:{},message:{},primary:{},secondary:{},progress:{
        stopAnimation:function(){this.animating=false;},startAnimation:function(){this.animating=true;}},
        window:{standardWindowButton:function(){return state.closeButton||(state.closeButton={});},
            orderOut:function(){state.hidden=true;},makeKeyAndOrderFront:function(){state.shows++;}}};
    $.NSApplication={sharedApplication:{stopModalWithCode:function(code){state.stopped.push(code);}}};
    return state;
}
check('progress reflects downloaded bytes and handoff disables all cancellation routes',function(){
    var s=setupUpdater(),view=updateViewFixture();
    updater.job={phase:'download',output:'/download',release:{size:200,version:'2.0.0 Beta 1'}};
    s.sizes['/download']=50;betaUpdateSync();
    assert(betaUpdateUI.view.progress.doubleValue===25 && !betaUpdateUI.view.progress.indeterminate);
    updater.job.phase='hash';betaUpdateSync();assert(betaUpdateUI.view.progress.animating);
    updater.job.phase='handoff';betaUpdateSync();assert(!betaUpdateUI.view.secondary.enabled && !view.closeButton.enabled);
    betaUpdateClose();assert(!view.hidden && updater.job);
});
check('window Cancel waits for curl exit and closing does not stop speech',function(){
    var s=setupUpdater(),v=updateViewFixture(),task=fakeUpdateTask(true);
    active=true;var speech=synth;
    updater.job={phase:'download',task:task,output:'/d',directory:'/owned',release:{size:100},limit:200,deadline:Date.now()+10000};
    betaUpdateClose();assert(v.hidden && task.terminated && !s.removed.length && active && !speech.wasStopped);
    task.running=false;updateTick();assert(!updater.job && s.removed.length===1);
});
check('confirm buttons and close return distinct modal decisions',function(){
    setupUpdater();var v=updateViewFixture();betaUpdateUI.confirming=true;
    betaUpdatePrimary();betaUpdateSecondary();betaUpdateClose();
    assert(JSON.stringify(v.stopped)==='[1,0,0]');
    betaUpdateUI.confirming=false;
});
check('background checks do not create a window and use existing channel rules',function(){
    var s=setupUpdater();betaUpdateUI.view=null;
    updater.job={phase:'check',output:'/releases',directory:'/owned',manual:false,page:1,releases:[],beta:true};
    s.files['/releases']='[]';updateAdvance(updater.job);
    assert(!updater.job && !betaUpdateUI.view);
});
'''
        results=json.loads(evaluate('(function () {\n'+body+'\nreturn JSON.stringify(testResults);\n}());'))
        self.assertGreaterEqual(len(results),18)
        for case in results:
            with self.subTest(case=case['name']):self.assertTrue(case['passed'],case.get('error'))

    @unittest.skipUnless(sys.platform=='darwin','Native palette and update window require macOS')
    def test_native_palette_and_update_window(self):
        script='(function () {\n'+combined()+r'''
var saved={};defaults={objectForKey:function(key){return saved[ObjC.unwrap(key)];},
 setObjectForKey:function(value,key){saved[ObjC.unwrap(key)]=ObjC.unwrap(value);},
 setDoubleForKey:function(value,key){saved[ObjC.unwrap(key)]=Number(value);}};
initLocalization();initTheme();registerController();buildMainWindow();betaDesignShowSettings();
betaDesign.settings.accentPreset.selectItemAtIndex(1);
betaDesign.controller.accentPreset(betaDesign.settings.accentPreset);
if(betaAccentRGB[1]!==1) throw new Error('Preset not applied');
betaDesign.settings.accentWell.color=$.NSColor.colorWithSRGBRedGreenBlueAlpha(0.3,0.6,0.9,1);
betaDesign.controller.accentColor(betaDesign.settings.accentWell);
if(Math.abs(betaAccentRGB[1]-0.6)>0.001) throw new Error('Custom color not applied');
var view=betaUpdateWindow();betaUpdateSync();view.window.makeKeyAndOrderFront($());
if(!view.window.opaque) throw new Error('Transparent update window');
view.window.cancelOperation($());if(view.window.visible) throw new Error('Escape failed');
betaDesignCloseSettings();ui.window.orderOut($());
return 'ok';
}());
'''
        p=subprocess.run(['/usr/bin/osascript','-l','JavaScript','-e',script],capture_output=True,text=True,timeout=30)
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout.strip(),'ok')
