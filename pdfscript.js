// PDFから行を取り出す処理と、台本(役名＋セリフ)に分解する処理。横書き・縦書きの両対応。

// 縦書き用の約物（︵ ︒ ﹁ など）を通常の文字に戻す
const VMAP={"︵":"（","︶":"）","︒":"。","︑":"、","︷":"｛","︸":"｝","︹":"〔","︺":"〕","︻":"【","︼":"】","︽":"《","︾":"》","︿":"〈","﹀":"〉","﹁":"「","﹂":"」","﹃":"『","﹄":"』","︙":"…","︱":"ー","︲":"－","︕":"！","︖":"？","︓":"：","︔":"；","︐":"，"};
const norm=s=>s.replace(/[\uFE10-\uFE19\uFE30-\uFE44]/g,c=>VMAP[c]||c);

const SP1=/^([^\s　「『（(【\[:：○△■]{1,10})[\s　:：]+(.+)$/, SP2=/^([^\s　「『（(【\[:：○△■]{1,10})([「『].*)$/;
export const isDir=t=>/^[○△■【\[]/.test(t);
export const speakerOf=t=>{const m=t.match(SP2)||t.match(SP1);return m?[m[1],m[2]]:null};

// ページ番号らしい行（数字だけ・「- 3 -」「3/20」など）
const isPageNo=t=>/^[\-－ー–—‐\s]*((p\.?|page|ページ)\s*)?[0-9０-９]{1,4}(\s*[\/／]\s*[0-9０-９]{1,4})?\s*(ページ|頁)?[\-－ー–—‐\s]*$/i.test(t);

// 1ページ分のテキストを「行」(横書き)または「列」(縦書き)にまとめる
export async function extractRows(page,p,Util){
  const vp=page.getViewport({scale:1}), tc=await page.getTextContent(), its=[];
  for(const it of tc.items){
    if(!it.str) continue;
    const t=Util.transform(vp.transform,it.transform);
    const fs=Math.hypot(t[0],t[1])||Math.hypot(t[2],t[3])||10;
    const vf=!!(tc.styles[it.fontName]&&tc.styles[it.fontName].vertical); // 縦書きフォント
    // 文字の外枠(4隅)から、向きに関係なく中心と範囲を求める（回転した数字・英字用）
    const L=Math.hypot(t[0],t[1])||1, ux=t[0]/L, uy=t[1]/L, xs=[], ys=[];
    for(const s of [0,1]) for(const k of [-0.12,0.88]){xs.push(t[4]+ux*it.width*s+t[2]*k); ys.push(t[5]+uy*it.width*s+t[3]*k)}
    its.push({s:it.str,blank:!it.str.trim(),x:t[4],y:t[5],w:it.width,len:vf?Math.max(it.height,it.width):it.width,fs,vf,
      bx:(Math.min(...xs)+Math.max(...xs))/2, by0:Math.min(...ys), by1:Math.max(...ys)});
  }
  // ページの端にあるページ番号は、列や行にまとめる前に除外する（列と重なって混ざるのを防ぐ）
  const pw=vp.width, ph=vp.height;
  const inMargin=(cx,cy)=>cy<ph*.1||cy>ph*.9||cx<pw*.08||cx>pw*.92;
  for(let k=its.length-1;k>=0;k--){const it=its[k]; if(!it.vf&&isPageNo(it.s)&&inMargin(it.bx,(it.by0+it.by1)/2)) its.splice(k,1)}
  // 向きの判定：縦書きフォントが多い、または1文字ずつ下へ並んでいる
  let vc=0,tot=0,V=0,H=0;
  its.forEach((a,k)=>{
    if(a.blank) return; tot+=a.s.length; if(a.vf) vc+=a.s.length;
    const b=its[k+1]; if(!b||b.blank||a.vf) return;
    const dx=b.x-a.x, dy=b.y-a.y, f=a.fs;
    if(a.s.length===1&&Math.abs(dx)<f*.3&&dy>f*.5&&dy<f*1.8) V++;
    else if(Math.abs(dy)<f*.3&&dx>0&&(a.s.length>1||dx<f*1.8)) H++;
  });
  if(!tot) return [];
  const vertical=vc*2>tot||V>H;
  const join=(parts,start,end)=>{
    let s="";
    parts.forEach((q,k)=>{
      if(k&&!q.blank&&!parts[k-1].blank&&start(q)-end(parts[k-1])>q.fs*.25) s+="　";
      s+=q.s;
    });
    return norm(s).trim();
  };
  const rows=[];
  if(!vertical){
    its.sort((a,b)=>a.y-b.y||a.x-b.x);
    const g=[];
    for(const it of its){const r=g[g.length-1]; if(r&&Math.abs(r.y-it.y)<it.fs*.5) r.parts.push(it); else g.push({y:it.y,parts:[it]})}
    for(const r of g){
      r.parts.sort((a,b)=>a.x-b.x);
      const nb=r.parts.filter(q=>!q.blank); if(!nb.length) continue;
      const fs=Math.max(...nb.map(q=>q.fs)), x0=Math.min(...nb.map(q=>q.x)), x1=Math.max(...nb.map(q=>q.x+q.w));
      rows.push({page:p,text:join(r.parts,q=>q.x,q=>q.x+q.w),x:x0,y:r.y-fs*.9,w:x1-x0,h:fs*1.2,vertical:false});
    }
  }else{
    // 列の中心x と 文字列の上端yを求める
    for(const it of its){it.cx=it.vf?it.x:it.bx; it.top=it.vf?it.y:it.by0; if(!it.vf) it.len=it.by1-it.by0}
    its.sort((a,b)=>b.cx-a.cx||a.top-b.top);           // 右の列から順に
    const g=[];
    for(const it of its){const r=g[g.length-1]; if(r&&Math.abs(r.cx-it.cx)<it.fs*.6) r.parts.push(it); else g.push({cx:it.cx,parts:[it]})}
    for(const r of g){
      r.parts.sort((a,b)=>a.top-b.top);
      const nb=r.parts.filter(q=>!q.blank); if(!nb.length) continue;
      const fs=Math.max(...nb.map(q=>q.fs)), y0=Math.min(...nb.map(q=>q.top)), y1=Math.max(...nb.map(q=>q.top+q.len));
      rows.push({page:p,text:join(r.parts,q=>q.top,q=>q.top+q.len),x:r.cx-fs/2,y:y0,w:fs,h:y1-y0,vertical:true});
    }
  }
  // ページの端（上下左右の余白）にあるページ番号は除外する
  return rows.filter(r=>r.text&&!(isPageNo(r.text)&&inMargin(r.x+r.w/2,r.y+r.h/2)));
}

// 行のリスト → 役名候補・セリフ項目（ト書き／セリフ）
// opts.parenDir: true なら「（」「(」で始まる行をト書きとして新しい項目にする
// opts.softBreak: true なら、行末が短く文が終わっている行（Wordのshift+Enter等の手動改行）の次の行を新しい項目にする
const SEP=/[・･、,，\/／＆&＋+]/;
// 行頭の「役名＋セリフ」の候補を返す。[役名, セリフ, 「」で閉じているか, 先頭1語目だけか]
// 役名の中に空白が入る場合（「尾　辺」のように1文字ずつ空白で区切った役名）も、空白を除いた形で候補にする
// 「佐藤・田中　セリフ」を、文字の間・「・」の前後に空白が入っていても読み取る（例：「佐　藤 ・ 田　中　セリフ」）
// 返り値：[「佐藤・田中」の形に直した役名, セリフ] または null
function multiHead(t,known){
  const n=t.length, ws=c=>/[\s　]/.test(c), sep=c=>SEP.test(c), stop=c=>/[:：「『（(【\[○△■]/.test(c);
  let i=0;
  const tok=()=>{let s="",j=i; while(j<n&&!ws(t[j])&&!sep(t[j])&&!stop(t[j])) s+=t[j++]; return [s,j]};
  const part=()=>{
    let [s,j]=tok(); if(!s) return null;
    if(known){                        // 「奈々 子」のように空白で分かれた既知の役名は、最も長く一致するものを採用
      let acc=s, jj=j, best=known.has(s)?[s,j]:null;
      for(let step=0;step<3;step++){
        let k=jj; while(k<n&&ws(t[k])) k++; if(k===jj||k>=n) break;
        const sv=i; i=k; const [s2,j2]=tok(); i=sv; if(!s2) break;
        acc+=s2; jj=j2; if(known.has(acc)) best=[acc,jj];
      }
      if(best){i=best[1]; return best[0]}
    }
    if([...s].length===1){            // 「尾　辺」のように1文字ずつ空白で区切られた名前
      for(;;){
        let k=j; while(k<n&&ws(t[k])) k++; if(k===j||k>=n) break;
        const sv=i; i=k; const [s2,j2]=tok(); i=sv;
        if([...s2].length===1&&(j2>=n||ws(t[j2])||sep(t[j2]))){s+=s2;j=j2}else break;
      }
    }
    i=j; return s;
  };
  const first=part(); if(!first) return null;
  let name=first, cnt=1;
  for(;;){
    const save=i; let k=i; while(k<n&&ws(t[k])) k++;
    if(k<n&&sep(t[k])){const sp=t[k]; i=k+1; while(i<n&&ws(t[i])) i++; const q=part(); if(q){name+=sp+q;cnt++;continue}}
    i=save; break;
  }
  if(cnt<2||name.length>14) return null;
  const rest=t.slice(i), m=rest.match(/^[\s　:：]+(.+)$/);
  if(m) return [name,m[1]];
  if(/^[「『]/.test(rest)&&rest.length>1) return [name,rest];
  return null;
}
function cand(t,known){
  const out=[], m2=t.match(SP2);
  if(m2) out.push([m2[1],m2[2],/^[「『].*[」』]$/.test(m2[2].trim()),true]);
  const mh=multiHead(t,known); if(mh&&!(m2&&m2[1]===mh[0])) out.push([mh[0],mh[1],/^[「『].*[」』]$/.test(mh[1].trim()),true]);
  for(let k=1;k<=3;k++){
    const m=t.match(new RegExp("^((?:[^\\s　:：]+[\\s　]+){"+(k-1)+"}[^\\s　:：]+)[\\s　:：]+(.+)$"));
    if(!m) break;
    const toks=m[1].split(/[\s　]+/);
    // 2語目以降は「名前を空白で区切った形」のときだけ（各語が2文字以内で、1文字の語を含む：尾　辺／奈々　子）
    if(k>=2&&(toks.some(s=>[...s].length>2)||!toks.some(s=>[...s].length===1))) break;
    const name=m[1].replace(/[\s　]/g,"");
    if(name.length>10||/[「『（(【\[○△■]/.test(name)) continue;
    out.push([name,m[2],/^[「『].*[」』]$/.test(m[2].trim()),k===1]);
  }
  return out;
}
export function parseRows(rows,manual=[],opts={}){
  const dir=t=>(opts.parenDir?/^[（(○△■【\[]/:/^[○△■【\[]/).test(t);
  // 候補ごとの出現数を数える
  const tally=rc=>{
    const cnt=new Map(), cnt1=new Map(), strong=new Set();
    for(const cs of rc){
      const seen=new Set();
      for(const [n,,s,first] of cs){
        if(seen.has(n)) continue; seen.add(n);
        cnt.set(n,(cnt.get(n)||0)+1); if(first) cnt1.set(n,(cnt1.get(n)||0)+1);
        if(s&&n.length<=8) strong.add(n);   // 「役名「セリフ」」の形なら1回だけの役名も採用
      }
    }
    return {cnt,cnt1,strong};
  };
  // 1回目で役名を見つけ、2回目はその役名を手がかりに（「奈々 子・佐藤」のような）複数人の役名を読み直す
  const t0=tally(rows.map(r=>dir(r.text)?[]:cand(r.text,null)));
  const known=new Set([...t0.cnt].filter(([n,c])=>(c>=2||t0.strong.has(n))&&!SEP.test(n)&&n.length>=2).map(([n])=>n));
  const rc=rows.map(r=>dir(r.text)?[]:cand(r.text,known));
  const {cnt,cnt1,strong}=tally(rc);
  // 役名だけで1行(1列)になっている台本：短くて句読点がなく、次の行より短い行が2回以上出てくれば役名とみなす
  const only=new Set();
  if([...cnt1].filter(([,c])=>c>=2).length<2){
    const c2=new Map();
    rows.forEach((r,k)=>{const t=r.text.trim(), nx=rows[k+1];
      if(nx&&t&&t.length<=8&&nx.text.trim().length>t.length&&!dir(t)&&!/[。、！？!?「」『』（）()…]/.test(t)) c2.set(t,(c2.get(t)||0)+1)});
    for(const [n,c] of c2) if(c>=2){cnt.set(n,c);only.add(n)}
  }
  for(const n of manual) cnt.set(n,Math.max(cnt.get(n)||0,2));
  // 「佐藤・田中」型の役名か：各パートが単独の役名として出ていれば複数人とみなす（「・」のみの場合は全員、他の区切りは1人でも）
  const multiOf=(n,known)=>{
    if(!SEP.test(n)) return null;
    const parts=n.split(SEP).filter(Boolean); if(parts.length<2||parts.some(s=>s.length>6)) return null;
    const k=parts.filter(known).length, dotOnly=!/[、,，\/／＆&＋+]/.test(n);
    return (k===parts.length||(k>=1&&!dotOnly))?parts:null;
  };
  const kn=s=>cnt.get(s)>=2;
  const valid=n=>cnt.get(n)>=2||strong.has(n)||!!multiOf(n,kn);
  const better=(a,b)=>{ // 複数人の役名を優先 → 出現数が多い → 長い
    if(!b) return true;
    const ma=!!multiOf(a[0],kn), mb=!!multiOf(b[0],kn); if(ma!==mb) return ma;
    const ca=cnt.get(a[0]), cb=cnt.get(b[0]); if(ca!==cb) return ca>cb;
    return a[0].length>b[0].length;
  };
  // 2回目：各行で、出現数が最も多い（同数なら長い）候補を役名として採用
  const rowSp=rows.map((r,ri)=>{
    let best=null;
    for(const c of rc[ri]){ if(valid(c[0])&&better(c,best)) best=c }
    return best&&[best[0],best[1]];
  });
  const fc=new Map(); rowSp.forEach(s=>{if(s) fc.set(s[0],(fc.get(s[0])||0)+1)});
  for(const n of only) if(!fc.has(n)) fc.set(n,cnt.get(n));
  for(const n of manual) if(!fc.has(n)) fc.set(n,2);
  let names=new Map([...fc].filter(([n,c])=>c>=2||strong.has(n)||manual.includes(n)||!!multiOf(n,kn)));
  // 「佐藤・田中」のように複数人が同時に言うセリフ：それぞれの役として扱う
  const multi=new Map();
  for(const [n] of names){
    const parts=multiOf(n,s=>names.has(s)||kn(s)); if(parts) multi.set(n,parts);
  }
  if(multi.size){
    const m=new Map(names);
    for(const [n,parts] of multi){const c=m.get(n); m.delete(n); for(const s of parts) m.set(s,(m.get(s)||0)+c)}
    names=m;
  }
  names=new Map([...names].sort((a,b)=>b[1]-a[1]));
  const spOf=n=>multi.get(n)||[n];
  const okName=n=>names.has(n)||multi.has(n);
  const nameOnly=t=>okName(t.trim())&&(only.has(t.trim())||manual.includes(t.trim())||!cand(t).some(c=>okName(c[0])));
  // 括弧が閉じて完結した項目の後ろに続く名前なしの行は、前の項目の続きではなく新しい項目にする
  const closed=it=>{
    const t=it.text.trim(), n=(re)=>(t.match(re)||[]).length;
    if(it.type==="line") return n(/[「『]/g)>0&&n(/[「『]/g)===n(/[」』]/g)&&/[」』]$/.test(t);
    return n(/[（(]/g)>0&&n(/[（(]/g)===n(/[）)]/g)&&/[）)]$/.test(t);
  };
  // 自動折り返しの行は右端(縦書きは下端)ぎりぎりまで文字が入る。手前で終わる行は手動改行とみなす
  const edge=r=>r.vertical?r.y+r.h:r.x+r.w, fsz=r=>(r.vertical?r.w:r.h/1.2)||10;
  // 右端：「折り返しの行末」が何本も集まっている位置を探す（1本だけ飛び出した行に引きずられない）
  const es=rows.map(edge).sort((a,b)=>b-a), fm=rows.map(fsz).sort((a,b)=>a-b)[rows.length>>1]||10, need=Math.max(3,Math.ceil(rows.length*.04));
  let Rmax=es[0]||0;
  for(let i=0;i<es.length;i++){let n=0; for(let k=i;k<es.length&&es[k]>=es[i]-fm*1.5;k++) n++; if(n>=need){Rmax=es[i];break}}
  const full=r=>edge(r)>=Rmax-fsz(r)*2.5;
  // 役名の直後に区切りなしでセリフが続く行（例：「佐藤そうだっけ？」）：既知の役名で始まり、
  // 他のセリフ行と同じ位置から始まっている場合だけセリフとみなす
  const start=r=>r.vertical?r.y:r.x, sorted=[...names.keys(),...multi.keys()].filter(n=>n.length>=2).sort((a,b)=>b.length-a.length);
  const st=[]; rows.forEach((r,ri)=>{const s=rowSp[ri]; if(s&&okName(s[0])) st.push(start(r))});
  st.sort((a,b)=>a-b); const med=st.length>=2?st[st.length>>1]:null;
  const prefixSp=r=>{
    const t=r.text; if(med===null||dir(t)||Math.abs(start(r)-med)>fsz(r)*.6) return null;
    for(const n of sorted){
      if(!t.startsWith(n)||t.length<=n.length) continue;
      const rest=t.slice(n.length);
      if(/^[はがをにへ]/.test(rest)&&!/[？！!?」』…]$/.test(rest.trim())) return null; // 「佐藤は立ち上がる。」などはト書き
      return [n,rest];
    }
    return null;
  };
  const items=[]; let cur=null;
  const mk=(n,text,r,ri)=>{cur={type:"line",speaker:n,speakers:spOf(n),text,page:r.page,rows:[ri]};items.push(cur)};
  rows.forEach((r,ri)=>{
    const t=r.text, paren=/^[（(]/.test(t); let sp=!dir(t)&&rowSp[ri]; if(!(sp&&okName(sp[0]))&&!dir(t)) sp=prefixSp(r);
    if(sp&&okName(sp[0])) mk(sp[0],sp[1],r,ri);
    else if(!dir(t)&&nameOnly(t)) mk(t.trim(),"",r,ri);
    else if(dir(t)){cur={type:"dir",text:t,page:r.page,rows:[ri]};items.push(cur)}
    else if(cur&&(paren||(!closed(cur)&&(!opts.softBreak||cur.text===""||full(rows[cur.rows[cur.rows.length-1]])||!/[。！？!?」』）)…♪]$/.test(rows[cur.rows[cur.rows.length-1]].text.trim()))))){cur.text+=t;cur.rows.push(ri)}
    else{cur={type:"dir",text:t,page:r.page,rows:[ri]};items.push(cur)}
  });
  const rowItem=[]; items.forEach((it,k)=>it.rows.forEach(ri=>rowItem[ri]=k));
  return {names,items,rowItem};
}
