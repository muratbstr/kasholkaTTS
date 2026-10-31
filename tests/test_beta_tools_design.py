import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from js_engine import evaluate

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('tools_builder', ROOT / 'scripts/build_beta.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

def source():
    return (ROOT/'tests/app_harness.js').read_text(encoding='utf-8')+'\n'+builder.beta_source()

FIXTURE = r'''
function toolsFixture() {
    betaJob=null; betaMenuItems=[]; betaReport={probe:null,say:null}; betaPitch.view=null;
    betaExport.view=null; betaDesign.settings=null;
    betaSiri={view:null,session:null,message:''}; betaDiagnostic={view:null,tab:0,snapshot:'',copied:false};
    wordDiagnostics={armed:false,recording:false,header:null,events:[]};
    var f={definitions:{},windows:[],clipboard:''};
    function makeControl(frame){return {frame:frame,setAccessibilityLabel:function(){}};}
    $.NSMakeRect=function(x,y,w,h){return [x,y,w,h];};$.NSMakeSize=function(w,h){return {width:w,height:h};};
    $.NSColor={whiteColor:'white',blackColor:'black',disabledControlTextColor:'disabled',secondaryLabelColor:'secondary',textColor:'text',textBackgroundColor:'background'};
    $.NSFont={systemFontOfSize:function(size){return size;}};
    $.NSTextField={wrappingLabelWithString:function(text){return {stringValue:text};}};
    $.NSScrollView={alloc:{initWithFrame:makeControl}};
    $.NSTextView={alloc:{initWithFrame:function(frame){return {frame:frame,textContainer:{}};}}};
    $.NSPopUpButton={alloc:{initWithFramePullsDown:function(frame){return {
        frame:frame,titles:[],indexOfSelectedItem:0,addItemWithTitle:function(title){this.titles.push(title);},
        selectItemAtIndex:function(i){this.indexOfSelectedItem=i;},setAccessibilityLabel:function(){}
    };}}};
    $.NSSegmentedControl={alloc:{initWithFrame:function(frame){return {frame:frame,titles:[],
        setLabelForSegment:function(text,i){this.titles[i]=text;},setWidthForSegment:function(){},setAccessibilityLabel:function(){}};}}};
    $.NSProgressIndicator={alloc:{initWithFrame:function(frame){return {frame:frame,
        startAnimation:function(){this.running=true;},stopAnimation:function(){this.running=false;}};}}};
    $.NSPasteboard={generalPasteboard:{setStringForType:function(text){f.clipboard=text;return !f.clipboardFails;}}};
    ObjC.registerSubclass=function(def){
        f.definitions[def.name]=def;
        if(def.superclass==='NSWindow') $[def.name]={alloc:{initWithContentRectStyleMaskBackingDefer:function(frame){
            var close={},window={frame:frame,visible:false,contentView:{children:[],addSubview:function(c){this.children.push(c);}},
                standardWindowButton:function(){return close;},isEqual:function(other){return this===other;},
                orderOut:function(sender){assert(sender===bridgedNil);this.visible=false;},
                makeKeyAndOrderFront:function(sender){assert(sender===bridgedNil);this.visible=true;}};
            f.windows.push(window);return window;
        }}};
        else $[def.name]={alloc:{init:{}}};
    };
    betaDesignMakeButton=function(parent,title,action,target,frame){var button={title:title,action:action,target:target,frame:frame};parent.addSubview(button);return button;};
    betaTools.controller=null;return f;
}
'''

class BetaToolsDesignTests(unittest.TestCase):
    def test_windows_results_diagnostics_and_action_routing(self):
        body=source()+FIXTURE+r'''
check('window creation and all close routes preserve the reader and reuse windows',function(){
    var f=toolsFixture(),quits=0;
    terminateApp=function(){quits++;};
    searchSiriVoices();assert(betaSiri.view.window.visible && !voiceProbe && !betaJob);
    assert(betaSiri.view.mode.titles.length===5 && betaSiri.view.language.titles.length===4);
    assert(betaSiri.view.run.tag===1001 && !betaSiri.view.run.keyEquivalent);
    showVoiceDiagnostics();var diagnostic=betaDiagnostic.view.window;
    assert(betaDiagnostic.tab===0 && diagnostic.visible);
    showWordDiagnostics();assert(betaDiagnostic.tab===1 && !wordDiagnostics.armed);
    betaShowReport();assert(betaDiagnostic.tab===2 && betaDiagnostic.view.record.hidden);
    f.definitions.KasholkaBetaSiriWindow.methods['cancelOperation:']();assert(!betaSiri.view.window.visible);
    f.definitions.KasholkaBetaDiagnosticWindow.methods['cancelOperation:']();assert(!diagnostic.visible);
    betaSiriShow(1);betaDiagnosticShow(0);
    var methods=f.definitions.KasholkaBetaToolsController.methods;
    methods['windowShouldClose:'].implementation(betaSiri.view.window);
    methods['windowShouldClose:'].implementation(diagnostic);
    assert(!diagnostic.visible && !betaSiri.view.window.visible && f.windows.length===2 && quits===0);
    f.windows.forEach(function(window){
        assert(window.opaque && !window.titlebarAppearsTransparent);
        window.contentView.children.forEach(function(control){
            var a=control.frame,b=window.frame;
            assert(a[0]>=0 && a[1]>=0 && a[0]+a[2]<=b[2] && a[1]+a[3]<=b[3],'Control outside window');
        });
    });
});
check('Siri counts use actual unique IDs and locale filter never starts a probe',function(){
    var f=toolsFixture();
    voices=[{id:'normal',name:'Siri fake',locale:'ru-RU'},
        {id:'com.apple.siri.ru',name:'Russian',locale:'ru_RU'},
        {id:'com.apple.siri.us',name:'US',locale:'en-US'},
        {id:'com.apple.siri.us',name:'Duplicate',locale:'en_US'}];
    betaSiriShow(0);assert(betaSiriVoices('').length===2 && !voiceProbe);
    betaSiri.view.language.selectItemAtIndex(1);betaSiriSync();
    assert(betaSiri.view.report.string.indexOf('Russian')>=0 && betaSiri.view.report.string.indexOf('US')<0);
    assert(betaSiri.view.summary.stringValue.indexOf('2')>=0);
    betaSiri.view.language.selectItemAtIndex(3);betaSiriSync();
    assert(betaSiri.view.report.string.indexOf('нет')>=0 && !betaJob && !voiceProbe);
});
check('reports separate private text, copy displayed snapshot and never record on opening',function(){
    var f=toolsFixture();ui.editor.string='SECRET EDITOR TEXT';
    voiceDiagnostics={app:'77 voices'};voiceInventories={app:voices};
    wordDiagnostics.header={spokenStart:'PRIVATE EXCERPT'};wordDiagnostics.events=[{marked:'PRIVATE EXCERPT'}];
    betaDiagnosticShow(0);betaDiagnosticCopy();
    assert(f.clipboard.indexOf('PRIVATE')<0 && f.clipboard.indexOf('SECRET')<0 && f.clipboard.indexOf('77 voices')>=0);
    voiceDiagnostics.app='88 voices';betaDiagnosticCopy();assert(f.clipboard.indexOf('77 voices')>=0);
    betaDiagnosticSync(true);betaDiagnosticCopy();assert(f.clipboard.indexOf('88 voices')>=0);
    betaDiagnosticShow(1);assert(!wordDiagnostics.armed && !wordDiagnostics.recording);
    betaDiagnosticCopy();assert(f.clipboard.indexOf('PRIVATE EXCERPT')>=0);
    betaDiagnosticShow(2);betaDiagnosticCopy();assert(f.clipboard.indexOf('PRIVATE')<0 && f.clipboard.indexOf('SECRET')<0);
    f.clipboardFails=true;betaDiagnosticCopy();assert(betaDiagnostic.view.note.stringValue.indexOf('Не удалось')>=0);
});
check('word recording is opt in, can stop without stopping speech, and clear cancels arming',function(){
    var f=toolsFixture();betaDiagnosticShow(1);
    assert(!betaDiagnostic.view.copy.enabled && !wordDiagnostics.armed);
    betaDiagnosticRecord();assert(wordDiagnostics.armed);
    betaDiagnosticClear();assert(!wordDiagnostics.armed && !wordDiagnostics.events.length);
    betaDiagnosticRecord();reading={offset:0,selection:{location:0,length:0}};
    beginWordDiagnostics('Test sample');assert(wordDiagnostics.recording && !wordDiagnostics.armed);
    active=true;var speech=synth;betaDiagnosticSync(false);assert(betaDiagnostic.view.record.enabled && !betaDiagnostic.view.clear.enabled);
    betaDiagnosticClear();assert(wordDiagnostics.recording);
    betaDiagnosticRecord();assert(!wordDiagnostics.recording && active && synth===speech && !speech.wasStopped);
    betaDiagnosticRecord();assert(!wordDiagnostics.armed);
    betaDiagnosticClose();assert(active);
    active=false;betaDiagnosticClear();assert(!wordDiagnostics.header);
});
check('inventory cancellation only disposes the owned job and preserves unrelated reading',function(){
    var f=toolsFixture(),disposed=[];betaSiriShow(0);
    var oldDispose=disposeHostJob;
    disposeHostJob=function(job){disposed.push(job);};
    try {
        var job={backend:'swift'};voiceProbe=job;betaSiri.session={kind:'inventory',job:job};
        active=true;hostSpeech={id:'unrelated'};var speech=synth;
        betaSiriSync();assert(betaSiri.view.cancel.enabled && !betaSiri.view.run.enabled);
        betaSiriClose();assert(voiceProbe===job && active);
        betaSiriCancel();assert(disposed[0]===job && !voiceProbe && active && hostSpeech && !speech.wasStopped);
        var replacement={backend:'osascript'};voiceProbe=replacement;betaSiri.session={kind:'inventory',job:job};
        betaSiriCancel();assert(voiceProbe===replacement && disposed.length===1);
    } finally {disposeHostJob=oldDispose;voiceProbe=null;hostSpeech=null;active=false;}
});
check('opening while busy does not start experiments or mutate selection',function(){
    var f=toolsFixture();active=true;ui.editor.string='Keep';var selection=ui.editor.selectedRange;
    betaMenuItems=[{}];updateControls();assert(betaMenuItems[0].enabled,'Menu must reopen a running check');
    [0,1,2,3].forEach(function(mode){betaSiriShow(mode);betaSiriRun();assert(!betaJob && !voiceProbe && active);});
    assert(ui.editor.string==='Keep' && ui.editor.selectedRange===selection && !betaSiri.view.run.enabled);
    active=false;betaSiriShow(2);ui.editor.string='';betaSiriRun();
    assert(!betaJob && betaSiri.view.stage.stringValue.indexOf('Введите')>=0);
});
return JSON.stringify(testResults);
'''
        results=json.loads(evaluate('(function(){\n'+body+'\n}());'))
        self.assertEqual(len(results),6)
        for result in results:
            with self.subTest(case=result['name']):self.assertTrue(result['passed'],result.get('error'))

    def test_real_helper_lifecycle_in_new_window(self):
        # Reuse the existing engine fixtures, including real host replies and timeouts.
        fixtures=(ROOT/'tests/beta_cases.js').read_text(encoding='utf-8').split("checkBeta('Direct probe",1)[0]
        body=source()+fixtures+FIXTURE+r'''
check('new UI drives real ID probe success timeout failure cancel and repeated launch',function(){
    var uiFixture=toolsFixture(),f=betaFixture();
    try {
        betaSiriShow(1);betaSiriRun();var job=betaJob;
        assert(job && betaSiriOwnsJob() && betaSiri.view.progress.running, 'ID start: '+betaSiri.view.stage.stringValue);
        f.files[job.directory+'/result.json']={state:'voices',report:{attempts:[]},voices:[{id:'com.apple.siri.real',name:'Siri',locale:'ru-RU'}]};
        betaTick();assert(!betaJob && !betaSiri.session && !betaSiri.view.progress.running, 'ID completion: '+betaSiri.view.stage.stringValue);
        assert(betaSiri.view.report.string.indexOf('com.apple.siri.real')>=0 && betaSiri.view.run.enabled, 'ID results: '+betaSiri.view.stage.stringValue+' / '+betaSiri.view.report.string);
        betaSiriRun();job=betaJob;job.deadline=0;betaTick();
        assert(!active && betaSiri.view.stage.stringValue.indexOf('20')>=0, 'timeout: '+betaSiri.view.stage.stringValue);
        betaSiriRun();job=betaJob;betaSiriCancel();assert(!betaJob && !active && job.task.stopped && job.timer.invalidated,'ID cancel');
        betaSiriRun();job=betaJob;stop();assert(!betaJob && betaSiri.view.stage.stringValue.indexOf('отменена')>=0,'Main stop: '+betaSiri.view.stage.stringValue);
        f.launchFails=true;betaSiriRun();assert(!betaJob && !active && betaSiri.view.run.enabled && betaReport.probe.error,'ID launch failure');
    } finally {f.restore();}
});
check('new say UI uses selected text without dialog; system preparation preserves selection',function(){
    var uiFixture=toolsFixture(),f=betaFixture();
    try {
        f.text='Private selected text';ui.editor.string='prefix '+f.text+' suffix';ui.editor.selectedRange=$.NSMakeRange(7,f.text.length);
        var selected=ui.editor.selectedRange,focused=false;
        ui.window={makeKeyAndOrderFront:function(){},makeFirstResponder:function(){focused=true;}};
        // The new UI must not open the legacy confirmation alert.
        $.NSAlert.alloc.init.runModal=1001;
        betaSiriShow(2);betaSiriRun();var job=betaJob;
        assert(job && f.files[job.directory+'/input.txt']===f.text && ui.editor.selectedRange===selected);
        job.task.running=false;betaTick();assert(!betaJob && !active && betaSiri.view.stage.stringValue.indexOf('не подтверждает')>=0);
        assert(betaDiagnosticReport(2).indexOf(f.text)<0);
        betaSiriShow(3);betaSiriRun();assert(focused && !betaJob && ui.editor.selectedRange===selected);
    } finally {f.restore();}
});
check('inventory ownership follows osascript to Swift and reports no Siri honestly',function(){
    var uiFixture=toolsFixture(),f=betaFixture();
    try {
        betaSiriShow(0);betaSiriRun();var first=voiceProbe;
        assert(first && first.backend==='osascript' && betaSiriOwnsJob(),'Inventory start: '+betaSiri.view.stage.stringValue);
        f.reply(first,{state:'voices',voices:[]});hostTick();
        assert(voiceProbe && voiceProbe.backend==='swift' && betaSiriOwnsJob() && betaSiri.session.job!==first,'Swift handoff: '+betaSiri.view.stage.stringValue);
        assert(betaSiri.view.stage.stringValue.indexOf('Swift')>=0);
        var second=voiceProbe;f.reply(second,{state:'voices',voices:[]});hostTick();
        assert(!voiceProbe && !betaSiri.session && !betaSiri.view.progress.running && betaSiriVoices('').length===0,'Inventory complete: '+betaSiri.view.stage.stringValue);
        assert(betaSiri.view.stage.stringValue.indexOf('не найдены')>=0,'No Siri: '+betaSiri.view.stage.stringValue);
        betaSiriRun();betaSiriCancel();assert(!voiceProbe && !hostTimer && betaSiri.view.run.enabled);
    } finally {f.restore();}
});
return JSON.stringify(testResults);
'''
        results=json.loads(evaluate('(function(){\n'+body+'\n}());'))
        self.assertEqual(len(results),3)
        for result in results:
            with self.subTest(case=result['name']):self.assertTrue(result['passed'],result.get('error'))

    @unittest.skipUnless(sys.platform=='darwin','Native utility windows require macOS')
    def test_native_windows_and_close(self):
        script='(function(){\n'+builder.beta_source()+r'''
var saved={};defaults={objectForKey:function(k){return saved[ObjC.unwrap(k)];},
setObjectForKey:function(v,k){saved[ObjC.unwrap(k)]=ObjC.unwrap(v);},setDoubleForKey:function(v,k){saved[ObjC.unwrap(k)]=Number(v);}};
initLocalization();initTheme();registerController();buildMainWindow();
searchSiriVoices();if(!betaSiri.view.window.visible || voiceProbe || betaJob)throw new Error('Unexpected launch');
betaSiri.view.window.cancelOperation($());if(betaSiri.view.window.visible)throw new Error('Escape failed');
betaSiriShow(1);betaSiri.view.window.performClose($());if(betaSiri.view.window.visible)throw new Error('Close failed');
betaSiriShow(2);betaSiri.view.window.standardWindowButton($.NSWindowCloseButton).performClick($());
if(betaSiri.view.window.visible)throw new Error('Red close failed');
showVoiceDiagnostics();showWordDiagnostics();betaShowReport();
var view=betaDiagnostic.view;if(!view.window.visible || Number(view.tabs.selectedSegment)!==2)throw new Error('Tabs missing');
view.window.cancelOperation($());if(view.window.visible)throw new Error('Escape failed');
showWordDiagnostics();view.window.performClose($());if(view.window.visible)throw new Error('Close failed');
showVoiceDiagnostics();view.window.standardWindowButton($.NSWindowCloseButton).performClick($());
if(view.window.visible)throw new Error('Red close failed');
ui.window.orderOut($());return 'ok';
}());
'''
        p=subprocess.run(['/usr/bin/osascript','-l','JavaScript','-e',script],capture_output=True,text=True,timeout=30)
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout.strip(),'ok')
