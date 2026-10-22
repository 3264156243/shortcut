#!/usr/bin/env node
// Local static preview. Feedback writes are intentionally unavailable here.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve('website'), port=Number(process.env.SC_PREVIEW_PORT||8877);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.json':'application/json'};
createServer(async(req,res)=>{
  try {
    let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:false,message:'Local preview: submission is available on the live website.'}));return;}
    if(path.endsWith('/'))path+='index.html';
    let file=resolve(root,'.'+path);
    if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    if(path==='/updates/latest.json')file=resolve('latest.json');
    const body=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:body);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('ShortCut preview: http://127.0.0.1:'+port));
