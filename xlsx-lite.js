
(function(){
  function u16(a,o){return a[o]|a[o+1]<<8}
  function u32(a,o){return (a[o]|a[o+1]<<8|a[o+2]<<16|a[o+3]<<24)>>>0}
  async function unzip(buffer){
    const a=new Uint8Array(buffer); let eocd=-1;
    for(let i=a.length-22;i>=Math.max(0,a.length-65557);i--) if(u32(a,i)===0x06054b50){eocd=i;break}
    if(eocd<0) throw new Error('Archivio XLSX non riconosciuto');
    const count=u16(a,eocd+10), cdOffset=u32(a,eocd+16), files={}; let p=cdOffset;
    for(let i=0;i<count;i++){
      if(u32(a,p)!==0x02014b50) throw new Error('Indice ZIP non valido');
      const method=u16(a,p+10), compSize=u32(a,p+20), nameLen=u16(a,p+28), extraLen=u16(a,p+30), commentLen=u16(a,p+32), localOffset=u32(a,p+42);
      const name=new TextDecoder().decode(a.slice(p+46,p+46+nameLen));
      const lp=localOffset, lname=u16(a,lp+26), lextra=u16(a,lp+28), start=lp+30+lname+lextra;
      const compressed=a.slice(start,start+compSize);
      let bytes;
      if(method===0) bytes=compressed;
      else if(method===8){
        if(typeof DecompressionStream==='undefined') throw new Error('Browser non compatibile con importazione XLSX');
        const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        bytes=new Uint8Array(await new Response(stream).arrayBuffer());
      } else throw new Error('Compressione XLSX non supportata');
      files[name]=bytes; p+=46+nameLen+extraLen+commentLen;
    }
    return files;
  }
  const txt=b=>new TextDecoder('utf-8').decode(b);
  const xml=s=>new DOMParser().parseFromString(s,'application/xml');
  function colName(ref){return (ref.match(/[A-Z]+/)||[''])[0]}
  async function readXlsx(file){
    const f=await unzip(await file.arrayBuffer());
    if(!f['xl/workbook.xml']) throw new Error('File Excel non valido');
    const wb=xml(txt(f['xl/workbook.xml']));
    const rel=xml(txt(f['xl/_rels/workbook.xml.rels']));
    const rels={}; rel.querySelectorAll('Relationship').forEach(x=>rels[x.getAttribute('Id')]=x.getAttribute('Target'));
    let sheet=Array.from(wb.querySelectorAll('sheet')).find(x=>x.getAttribute('name')==='Tutti')||wb.querySelector('sheet');
    let target=rels[sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sheet.getAttribute('r:id')];
    if(!target.startsWith('xl/')) target='xl/'+target.replace(/^\//,'');
    const shared=[];
    if(f['xl/sharedStrings.xml']){
      const ss=xml(txt(f['xl/sharedStrings.xml']));
      ss.querySelectorAll('si').forEach(si=>shared.push(Array.from(si.querySelectorAll('t')).map(t=>t.textContent||'').join('')));
    }
    const sx=xml(txt(f[target]));
    const rows=[];
    sx.querySelectorAll('sheetData > row').forEach(row=>{
      const obj={};
      row.querySelectorAll('c').forEach(c=>{
        const ref=c.getAttribute('r'), col=colName(ref), type=c.getAttribute('t');
        let v=c.querySelector('v')?.textContent ?? '';
        if(type==='s') v=shared[Number(v)]??'';
        else if(type==='inlineStr') v=Array.from(c.querySelectorAll('t')).map(t=>t.textContent||'').join('');
        obj[col]=v;
      }); rows.push(obj);
    });
    return normalize(rows);
  }
  function normalize(rows){
    let hi=rows.findIndex(r=>String(r.A).trim().toLowerCase()==='id' && String(r.D).trim().toLowerCase()==='nome');
    if(hi<0) throw new Error('Colonne Fantacalcio.it non riconosciute');
    return rows.slice(hi+1).filter(r=>r.A&&r.D).map(r=>({
      id:String(parseInt(r.A,10)),r:String(r.B||'').trim(),rm:String(r.C||'').trim(),
      n:String(r.D||'').trim(),t:String(r.E||'').trim(),qa:Number(r.F||0),qi:Number(r.G||0),
      diff:Number(r.H||0),fvm:Number(r.L||0)
    })).filter(p=>p.id&&p.n&&'PDCA'.includes(p.r));
  }
  function readCsv(text){
    const sep=(text.split('\n')[0].match(/;/g)||[]).length>(text.split('\n')[0].match(/,/g)||[]).length?';':',';
    const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
    const parse=line=>{let out=[],s='',q=false;for(let i=0;i<line.length;i++){let c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){s+='"';i++}else q=!q}else if(c===sep&&!q){out.push(s);s=''}else s+=c}out.push(s);return out};
    const all=lines.map(parse), h=all.findIndex(r=>String(r[0]).trim().toLowerCase()==='id');
    if(h<0) throw new Error('Intestazioni CSV non riconosciute');
    return all.slice(h+1).filter(r=>r[0]&&r[3]).map(r=>({id:String(parseInt(r[0],10)),r:r[1],rm:r[2],n:r[3],t:r[4],qa:Number(r[5]||0),qi:Number(r[6]||0),diff:Number(r[7]||0),fvm:Number(r[11]||0)})).filter(p=>p.id&&p.n&&'PDCA'.includes(p.r));
  }
  window.FantaExcel={async read(file){return file.name.toLowerCase().endsWith('.csv')?readCsv(await file.text()):readXlsx(file)}};
})();
