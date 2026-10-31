import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pitch_builder', ROOT / 'scripts/build_beta.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class BetaPitchTests(unittest.TestCase):
    def test_drafts_voice_switch_busy_state_and_errors(self):
        body = (ROOT / 'tests/app_harness.js').read_text(encoding='utf-8') + '\n' + builder.beta_source() + r'''
function pitchFixture() {
    betaJob = null; betaExport.view = null; betaExport.job = null; betaDesign.settings = null;
    $.NSColor = {whiteColor: 'white', blackColor: 'black', disabledControlTextColor: 'disabled'};
    debugPitchOffsets = {};
    betaPitch = {key: null, saved: null, message: '', controller: {}};
    var window = {visible: true, orderOut: function (sender) {assert(sender === bridgedNil);this.visible = false;}};
    betaPitch.view = {window: window, slider: {doubleValue: 0}, value: {}, voice: {}, message: {}, apply: {}, reset: {}};
    betaPitchSync(); return betaPitch.view;
}
check('dragging and reset remain drafts; Apply uses fresh synth and preserves editor', function () {
    var view = pitchFixture(), selected = synth, selection = {location: 2,length: 3};
    ui.editor.string = 'Keep this text'; ui.editor.selectedRange = selection;
    view.slider.doubleValue = 3.7; betaPitchChanged();
    assert(view.value.stringValue === '+3.7' && selectedPitchOffset() === 0);
    betaPitchApply();
    assert(selectedPitchOffset() === 3.7 && synth === selected && !selected.pitchWrites);
    assert(ui.editor.string === 'Keep this text' && ui.editor.selectedRange === selection);
    betaPitchReset(); assert(view.value.stringValue === '0' && selectedPitchOffset() === 3.7);
    betaPitchApply(); assert(selectedPitchOffset() === 0 && synth === selected);
});
check('unsupported pitch retains saved value and presents error; natural reset works', function () {
    var view = pitchFixture(); setDebugPitch(2); betaPitchSync();
    $.NSSpeechSynthesizer.alloc.initWithVoice = function () {var probe = fakeSynth(48);probe.writable=false;return probe;};
    view.slider.doubleValue = 8; betaPitchChanged(); betaPitchApply();
    assert(selectedPitchOffset() === 2 && view.slider.doubleValue === 8);
    assert(view.message.stringValue.indexOf('не поддерживает') >= 0 && view.apply.enabled);
    betaPitchReset(); betaPitchApply(); assert(selectedPitchOffset() === 0);
});
check('voice changes and external reset invalidate drafts rather than applying to new voice', function () {
    var view = pitchFixture();
    setDebugPitch(2); betaPitchSync(); view.slider.doubleValue = 8;
    voices.push({id:'voice-2',name:'Second',locale:'en_US',engine:'ns'});
    debugPitchOffsets[voiceKey(voices[1])] = -4;
    ui.voice.selectItemAtIndex(1);
    betaPitchApply(); assert(selectedPitchOffset() === -4 && view.slider.doubleValue === -4);
    assert(view.voice.stringValue === 'Second · en_US');
    view.slider.doubleValue = 7; delete debugPitchOffsets[voiceKey(voices[1])];
    betaPitchApply(); assert(selectedPitchOffset() === 0 && view.slider.doubleValue === 0);
    ui.voice.selectItemAtIndex(0); betaPitchSync(); assert(view.slider.doubleValue === 2);
    view.slider.doubleValue=6; reset(); assert(selectedPitchOffset()===0 && view.slider.doubleValue===0);
});
check('reading export and voice searches block mutation; close never cancels those jobs', function () {
    ['reading','export','search','beta'].forEach(function (mode) {
        var view = pitchFixture(); view.slider.doubleValue = 9;
        active = mode === 'reading'; audioExport = mode === 'export' ? {} : null;
        voiceProbe = mode === 'search' ? {} : null; betaJob = mode === 'beta' ? {} : null;
        var speech = synth;
        betaPitchSync(); assert(!view.slider.enabled && !view.reset.enabled && !view.apply.enabled);
        betaPitchApply(); betaPitchReset(); assert(selectedPitchOffset() === 0);
        betaPitchClose(); assert(!view.window.visible && !speech.wasStopped);
        assert(mode !== 'reading' || active); assert(mode !== 'export' || audioExport);
        assert(mode !== 'search' || voiceProbe); assert(mode !== 'beta' || betaJob);
        active=false; audioExport=null; voiceProbe=null; betaJob=null;
        betaPitchSync(); assert(view.apply.enabled && view.slider.doubleValue === 0);
    });
});
check('absence of voice or synth disables editor and preserves previous offsets', function () {
    var view = pitchFixture(); setDebugPitch(5); betaPitchSync();
    synth=null; betaPitchSync(); assert(!view.apply.enabled);
    view.slider.doubleValue=7; betaPitchApply(); assert(selectedPitchOffset()===5);
    voices=[]; betaPitchSync(); assert(!view.slider.enabled && view.voice.stringValue.indexOf('выберите')>=0);
    betaPitchApply(); assert(Object.keys(debugPitchOffsets).length===1);
});
check('AVFoundation offset uses existing path without optional NSSpeech properties', function () {
    var view=pitchFixture(); voices[0].engine='av'; engine='av'; synth=fakeAVSynth(); betaPitchSync();
    $.NSSpeechSynthesizer.alloc.initWithVoice=function(){throw new Error('Wrong engine');};
    view.slider.doubleValue=-12; betaPitchApply(); assert(selectedPitchOffset()===-12);
    view.slider.doubleValue=40; betaPitchApply(); assert(selectedPitchOffset()===12);
});
return JSON.stringify(testResults);
'''
        results = json.loads(evaluate('(function(){\n' + body + '\n}());'))
        self.assertEqual(len(results), 6)
        for result in results:
            with self.subTest(case=result['name']):
                self.assertTrue(result['passed'], result.get('error'))

    def test_window_creation_actions_close_and_reopen(self):
        body = (ROOT / 'tests/app_harness.js').read_text(encoding='utf-8') + '\n' + builder.beta_source() + r'''
setup(); betaJob=null;
var definitions={},windows=0,quits=0,oldRegister=ObjC.registerSubclass;
terminateApp=function(){quits++;};
$.NSColor={whiteColor:'white',blackColor:'black',disabledControlTextColor:'disabled',secondaryLabelColor:'secondary'};
$.NSFont={systemFontOfSize:function(){return {};}};
$.NSMakeRect=function(x,y,w,h){return [x,y,w,h];};
$.NSTextField={wrappingLabelWithString:function(text){return {stringValue:text};}};
$.NSSlider={alloc:{initWithFrame:function(frame){return {frame:frame,setAccessibilityLabel:function(){}};}}};
ObjC.registerSubclass=function(def){
    definitions[def.name]=def;
    if(def.superclass==='NSWindow') $[def.name]={alloc:{initWithContentRectStyleMaskBackingDefer:function(frame){
        windows++;var close={};
        return {frame:frame,visible:false,contentView:{addSubview:function(){}},standardWindowButton:function(){return close;},
            orderOut:function(sender){assert(sender===bridgedNil);this.visible=false;},
            makeKeyAndOrderFront:function(sender){assert(sender===bridgedNil);this.visible=true;}};
    }}};
    else $[def.name]={alloc:{init:{}}};
};
betaDesignMakeButton=function(parent,title,action,target,frame){return {title:title,action:action,target:target,frame:frame};};
showDebugPitch(); var view=betaPitch.view, controllerDef=definitions.KasholkaBetaPitchController;
assert(view.window.visible && view.window.titlebarAppearsTransparent===false && view.window.opaque);
assert(view.slider.continuous && view.apply.tag===1001 && view.apply.action==='apply:');
view.slider.doubleValue=4; controllerDef.methods['change:'].implementation({});
showDebugPitch(); assert(view.slider.doubleValue===4 && windows===1);
controllerDef.methods['apply:'].implementation({}); assert(selectedPitchOffset()===4);
var closeHandlers=[
    function(){definitions.KasholkaBetaPitchWindow.methods['cancelOperation:']({});},
    function(){assert(controllerDef.methods['windowShouldClose:'].implementation({})===false);},
    function(){controllerDef.methods['close:'].implementation({});}
];
closeHandlers.forEach(function(close){
    view.slider.doubleValue=9;close();assert(!view.window.visible);
    showDebugPitch();assert(view.window.visible && view.slider.doubleValue===4);
});
assert(windows===1 && quits===0);
return 'ok';
'''
        self.assertEqual(evaluate('(function(){\n'+body+'\n}());'), 'ok')

    @unittest.skipUnless(sys.platform == 'darwin', 'Native pitch window requires macOS')
    def test_native_window_and_close(self):
        script = '(function(){\n' + builder.beta_source() + r'''
var saved={};
defaults={objectForKey:function(key){return saved[ObjC.unwrap(key)];},
    setObjectForKey:function(value,key){saved[ObjC.unwrap(key)]=ObjC.unwrap(value);},
    setDoubleForKey:function(value,key){saved[ObjC.unwrap(key)]=Number(value);}};
initLocalization();initTheme();registerController();buildMainWindow();
voices=[{id:'test',name:'Test voice',locale:'ru_RU',engine:'av'}];
selectedVoice=function(){return voices[0];};synth={};engine='av';
showDebugPitch(); var view=betaPitch.view;
if(!view.window.visible || !view.apply.enabled)throw new Error('Window missing');
view.slider.doubleValue=3;view.apply.performClick($());
if(selectedPitchOffset()!==3)throw new Error('Apply failed');
view.window.cancelOperation($());if(view.window.visible)throw new Error('Escape failed');
showDebugPitch();view.window.performClose($());if(view.window.visible)throw new Error('Close failed');
showDebugPitch();view.window.standardWindowButton($.NSWindowCloseButton).performClick($());
if(view.window.visible)throw new Error('Red close failed');
ui.window.orderOut($());return 'ok';
}());
'''
        result = subprocess.run(['/usr/bin/osascript','-l','JavaScript','-e',script],capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout.strip(),'ok')
