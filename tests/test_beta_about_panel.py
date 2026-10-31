import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from js_engine import evaluate
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('panel_builder',ROOT/'scripts/build_beta.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

class AboutPanelTests(unittest.TestCase):
    def test_actual_about_path_creates_draws_and_stacks_panel_on_reopen(self):
        body=(ROOT/'tests/app_harness.js').read_text(encoding='utf-8')+'\n'+builder.beta_source()+r'''
var fixture=setupAboutFixture(), drawing, fills=0, chosenAlpha=0;
$.NSWindowAbove=1;
var makeWindow=$.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer;
$.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer=function(){
    var window=makeWindow();
    window.contentView.addSubviewPositionedRelativeTo=function(view,order,sibling){
        var i=fixture.children.indexOf(view);if(i>=0)fixture.children.splice(i,1);
        if(order===-1)fixture.children.unshift(view);
        else {assert(sibling===about.background);fixture.children.splice(fixture.children.indexOf(sibling)+1,0,view);}
    };
    return window;
};
$.NSTextField.labelWithString=function(text){return {stringValue:text,layer:{}};};
$.NSMakeSize=function(w,h){return {width:w,height:h};};
$.NSColor.colorWithCalibratedWhiteAlpha=function(white,alpha){
    var color={};Object.defineProperty(color,'setFill',{get:function(){assert(white===0);chosenAlpha=alpha;}});return color;
};
$.NSBezierPath={bezierPathWithRoundedRectXRadiusYRadius:function(bounds,x,y){
    assert(x===20 && y===20 && bounds===betaDesign.aboutPanel.bounds);
    var path={};Object.defineProperty(path,'fill',{get:function(){fills++;}});return path;
}};
ObjC.registerSubclass=function(def){
    assert(def.superclass==='NSView');drawing=def.methods['drawRect:'];
    $.KasholkaBetaAboutPanel={alloc:{initWithFrame:function(frame){return {bounds:frame,frame:frame,panel:true};}}};
};
showAbout();
var panel=betaDesign.aboutPanel;
assert(panel && panel.needsDisplay && typeof drawing==='function');
drawing.call(panel,panel.bounds);
assert(fills===1 && chosenAlpha===0.55);
assert(fixture.children[0]===about.background && fixture.children[1]===panel);
assert(fixture.children.slice(2).every(function(v){return typeof v.stringValue==='string';}));
var count=fixture.children.length;
showAbout();showAbout();
assert(fixture.windows===1 && fixture.children.length===count && fixture.children[1]===panel && fixture.starts===3);
return 'ok';
'''
        self.assertEqual(evaluate('(function(){\n'+body+'\n}());'),'ok')

    @unittest.skipUnless(sys.platform=='darwin','Actual AppKit drawing requires macOS')
    def test_native_panel_produces_visible_dark_pixels(self):
        script='(function(){\n'+builder.beta_source()+r'''
var window=$.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
    $.NSMakeRect(0,0,560,400),$.NSWindowStyleMaskTitled,$.NSBackingStoreBuffered,false);
var panel=betaCreateAboutPanel(window.contentView,$.NSMakeRect(60,112,440,176));
var image=$.NSImage.alloc.initWithSize($.NSMakeSize(440,176));
image.lockFocus;
try {panel.drawRect(panel.bounds);} finally {image.unlockFocus;}
var bitmap=$.NSBitmapImageRep.imageRepWithData(image.TIFFRepresentation);
var center=bitmap.colorAtXY(Math.floor(Number(bitmap.pixelsWide)/2),Math.floor(Number(bitmap.pixelsHigh)/2));
var rgb=center.colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);
if(Number(rgb.alphaComponent)<0.5 || Number(rgb.redComponent)>0.05)throw new Error('Panel did not draw dark pixels');
window.orderOut($());return 'ok';
}());
'''
        p=subprocess.run(['/usr/bin/osascript','-l','JavaScript','-e',script],capture_output=True,text=True,timeout=30)
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout.strip(),'ok')
