import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from js_engine import evaluate
from test_beta_tools_design import FIXTURE

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('shortcuts_builder',ROOT/'scripts/build_beta.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class BetaShortcutTests(unittest.TestCase):
    def test_shortcut_workflow_lifecycle_and_input(self):
        fixtures=(ROOT/'tests/beta_cases.js').read_text(encoding='utf-8').split("checkBeta('Direct probe",1)[0]
        body=(ROOT/'tests/app_harness.js').read_text(encoding='utf-8')+'\n'+builder.beta_source()+FIXTURE+fixtures+r'''
function shortcutFixture(){
    var uiFixture=toolsFixture();
    betaShortcut={view:null,controller:null,names:[],job:null,message:''};
    var f=betaFixture();f.ui=uiFixture;
    $.NSFileManager.defaultManager.isExecutableFileAtPath=function(path){assert(path==='/usr/bin/shortcuts');return !f.missingTool;};
    betaShortcutShow();
    var choice=betaShortcut.view.choice;
    Object.defineProperty(choice,'removeAllItems',{get:function(){this.titles=[];this.indexOfSelectedItem=-1;}});
    f.list=function(text){
        betaShortcutRefresh();var job=betaJob;
        assert(job && job.mode==='shortcuts-list');
        f.files[job.directory+'/shortcuts.txt']=text;job.task.running=false;betaTick();return job;
    };
    return f;
}
checkBeta('list is asynchronous, no execution on open, and only selected workflow can run',function(){
    var f=shortcutFixture();try {
        assert(!f.tasks.length && !betaShortcut.view.run.enabled);
        var job=f.list('Unrelated workflow\nMy reading shortcut\n');
        assert(job.task.launchPath==='/usr/bin/shortcuts' && JSON.stringify(job.task.arguments)==='["list"]');
        assert(job.task.standardOutput===job.outputHandle && !active && !betaJob);
        assert(!betaShortcut.view.run.enabled && betaShortcut.view.choice.indexOfSelectedItem===0);
        assert(betaShortcut.names.length===2 && betaReport['shortcuts-list'].count===2);
        betaShortcut.view.choice.selectItemAtIndex(2);betaShortcutSync();assert(betaShortcut.view.run.enabled);
        assert(job.timer.invalidated && f.permissions===448 && !f.files[job.directory+'/shortcuts.txt']);
    }finally{f.restore();}
});
checkBeta('Unicode and shell-like names and selected text use literal argv and private input',function(){
    var f=shortcutFixture();try {
        var name='Чтение "$(echo no)"';f.list(name+'\n');betaShortcut.view.choice.selectItemAtIndex(1);
        f.text='Русский 😀 $(echo private)';ui.editor.string='before '+f.text+' after';
        ui.editor.selectedRange=$.NSMakeRange(7,f.text.length);var selection=ui.editor.selectedRange,speech=synth;
        betaShortcutRun();var job=betaJob;
        assert(job.task.launchPath==='/usr/bin/shortcuts' && job.task.arguments[0]==='run' && job.task.arguments[1]===name);
        assert(job.task.arguments[2]==='--input-path' && f.files[job.task.arguments[3]]===f.text);
        assert(synth===speech && !speech.wasStopped && ui.editor.selectedRange===selection && ui.editor.string==='before '+f.text+' after');
        assert(active && !ui.pause.enabled && betaShortcut.view.cancel.enabled && betaShortcutOwnsJob());
        job.task.running=false;betaTick();
        assert(!active && !betaJob && !f.files[job.directory+'/input.txt'] && job.timer.invalidated);
        assert(betaShortcut.view.status.stringValue.indexOf('не подтверждает')>=0);
        assert(betaDiagnosticReport(2).indexOf('private')<0 && betaDiagnosticReport(2).indexOf(name)<0);
        assert(defaults.objectForKey('betaShortcutName')===name);
    }finally{f.restore();}
});
checkBeta('empty input, ambiguous list, option-like name, busy app and missing CLI are handled',function(){
    var f=shortcutFixture();try {
        f.list('Same\nSame\n');assert(!betaShortcut.names.length && !betaShortcut.view.run.enabled && betaReport['shortcuts-list'].error);
        f.list('');assert(!betaShortcut.names.length && betaShortcut.view.status.stringValue.indexOf('нет')>=0);
        f.list('-bad\n');betaShortcut.view.choice.selectItemAtIndex(1);
        var count=f.tasks.length;betaShortcutRun();assert(!betaJob && f.tasks.length===count);
        f.list('Reader\n');betaShortcut.view.choice.selectItemAtIndex(1);ui.editor.string='';count=f.tasks.length;
        betaShortcutRun();assert(!betaJob && f.tasks.length===count);
        active=true;betaShortcutRun();betaShortcutRefresh();assert(f.tasks.length===count && active);active=false;
        f.missingTool=true;betaShortcutRefresh();assert(!betaJob && f.tasks.length===count);
    }finally{f.restore();}
});
checkBeta('errors omit raw stderr and user text; timeouts and launch failures restore controls',function(){
    var f=shortcutFixture();try {
        betaShortcutRefresh();var job=betaJob;job.deadline=0;betaTick();
        assert(!active && !betaJob && job.task.stopped && betaReport['shortcuts-list'].error.indexOf('20')>=0);
        f.list('Reader\n');betaShortcut.view.choice.selectItemAtIndex(1);f.text=ui.editor.string='SECRET INPUT';
        betaShortcutRun();job=betaJob;f.files[job.directory+'/stderr.txt']=f.text;
        job.task.running=false;job.task.terminationStatus=1;betaTick();
        assert(!active && !betaJob && betaReport['shortcuts-run'].error.indexOf('1')>=0);
        assert(JSON.stringify(betaReport).indexOf('SECRET')<0 && !f.files[job.directory+'/input.txt']);
        f.launchFails=true;betaShortcutRun();assert(!active && !betaJob && betaShortcut.view.run.enabled);
        assert(betaReport['shortcuts-run'].state==='error');
    }finally{f.restore();}
});
checkBeta('closing preserves job; cancel and main Stop clean own task without claiming remote stop',function(){
    var f=shortcutFixture();try {
        f.list('kasholkaTTS Siri\n');assert(betaShortcut.view.choice.indexOfSelectedItem===1);
        f.text=ui.editor.string='Read this';betaShortcutRun();var job=betaJob;
        betaShortcutClose();assert(betaJob===job && active && job.task.running);
        betaShortcutShow();assert(betaShortcut.view.cancel.enabled);
        betaShortcutCancel();assert(!betaJob && !active && job.task.stopped && !f.files[job.directory+'/input.txt']);
        assert(betaShortcut.view.status.stringValue.indexOf('Если речь продолжается')>=0);
        betaShortcutRun();job=betaJob;stop();assert(!betaJob && job.task.stopped && !active);
        assert(betaShortcut.view.status.stringValue.indexOf('Если речь продолжается')>=0);
        betaJob={mode:'probe'};betaShortcut.job=null;betaShortcutCancel();assert(betaJob.mode==='probe');betaJob=null;
    }finally{f.restore();}
});
checkBeta('empty report window, native close action routes and explicit Shortcuts app opener',function(){
    var f=shortcutFixture();try {
        var w=betaShortcut.view.window;
        f.ui.definitions.KasholkaBetaShortcutWindow.methods['cancelOperation:']();assert(!w.visible);
        betaShortcutShow();f.ui.definitions.KasholkaBetaShortcutController.methods['windowShouldClose:'].implementation(w);assert(!w.visible);
        betaShortcutShow();assert(f.ui.windows.length===1);
        $.NSURL={URLWithString:function(url){assert(url==='shortcuts://');return url;}};
        var opened=0;$.NSWorkspace={sharedWorkspace:{openURL:function(url){opened++;return true;}}};
        betaShortcutOpenApp();assert(opened===1 && !betaJob);
        w.contentView.children.forEach(function(c){var a=c.frame;assert(a[0]>=0 && a[1]>=0 && a[0]+a[2]<=620 && a[1]+a[3]<=490);});
    }finally{f.restore();}
});
return JSON.stringify(testResults);
'''
        results=json.loads(evaluate('(function(){\n'+body+'\n}());'))
        self.assertEqual(len(results),6)
        for case in results:
            with self.subTest(case=case['name']):self.assertTrue(case['passed'],case.get('error'))

    @unittest.skipUnless(sys.platform=='darwin','Native Shortcuts window requires macOS')
    def test_native_window_without_running_shortcuts(self):
        script='(function(){\n'+builder.beta_source()+r'''
var saved={};defaults={objectForKey:function(k){return saved[ObjC.unwrap(k)];},
setObjectForKey:function(v,k){saved[ObjC.unwrap(k)]=ObjC.unwrap(v);},setDoubleForKey:function(v,k){saved[ObjC.unwrap(k)]=Number(v);}};
initLocalization();initTheme();registerController();buildMainWindow();
betaShortcutShow();var view=betaShortcut.view;
if(!view.window.visible || betaJob || view.run.enabled)throw new Error('Unexpected automatic run');
view.window.cancelOperation($());if(view.window.visible)throw new Error('Escape failed');
betaShortcutShow();view.window.performClose($());if(view.window.visible)throw new Error('Close failed');
betaShortcutShow();view.window.standardWindowButton($.NSWindowCloseButton).performClick($());
if(view.window.visible)throw new Error('Red close failed');
ui.window.orderOut($());return 'ok';
}());
'''
        p=subprocess.run(['/usr/bin/osascript','-l','JavaScript','-e',script],capture_output=True,text=True,timeout=30)
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout.strip(),'ok')
