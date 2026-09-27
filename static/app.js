'use strict';
/* ======================= 1. Core utilities & state ======================= */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isNum=v=>typeof v==='number'&&isFinite(v);
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pc=(a,b)=>isNum(a)&&isNum(b)&&b!==0?a/b*100:null;
const rt=(a,b)=>isNum(a)&&isNum(b)&&b!==0?a/b:null;
const sub=(a,b)=>isNum(a)&&isNum(b)?a-b:null;
const addN=(...a)=>a.every(isNum)?a.reduce((x,y)=>x+y,0):null;
const mul=(a,k)=>isNum(a)?a*k:null;
const absN=a=>isNum(a)?Math.abs(a):null;
const growth=(a,b)=>isNum(a)&&isNum(b)&&b!==0?(a-b)/Math.abs(b)*100:null;
const lastOf=a=>a[a.length-1];
const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

const S={companies:{},active:null,freq:'annual',selDate:null,unit:ls.get('ca-unit','auto'),tab:'overview',cmpOff:new Set(),fx:{},
  tbl:{income:{q:'',key:false,sort:null},balance:{q:'',key:false,sort:null},cashflow:{q:'',key:false,sort:null}},
  ratioSel:'roe',ratioGroup:'All',s3tab:'bs',s3all:false,s3nil:false,irFilter:'key',irQ:'',ratioQ:'',ds:null,online:false,cached:[],loading:null,snapshot:null,upCur:'INR',upUnit:'1e7'};
let SERVER=false;

/* ---------- formatting ---------- */
const SYM={INR:'₹',USD:'$',EUR:'€',GBP:'£',JPY:'¥',CNY:'¥',AUD:'A$',CAD:'C$',SGD:'S$',HKD:'HK$'};
const UNITS={cr:{d:1e7,s:' Cr',n:'Crore'},lakh:{d:1e5,s:' L',n:'Lakh'},mn:{d:1e6,s:' Mn',n:'Million'},bn:{d:1e9,s:' Bn',n:'Billion'},raw:{d:1,s:'',n:'(absolute)'}};
const unitOf=cur=>UNITS[S.unit==='auto'?(cur==='INR'?'cr':'mn'):S.unit];
const loc=cur=>cur==='INR'?'en-IN':'en-US';
function fmtNum(x,cur,dp){const a=Math.abs(x);if(dp==null)dp=a>=1000?0:a>=100?1:2;return x.toLocaleString(loc(cur),{maximumFractionDigits:dp,minimumFractionDigits:0})}
function fmtAmt(v,cur){if(!isNum(v))return'—';const u=unitOf(cur);return(v<0?'−':'')+(SYM[cur]??(cur?cur+' ':''))+fmtNum(Math.abs(v)/u.d,cur)+u.s}
const axisAmt=cur=>{const u=unitOf(cur);return v=>fmtNum(v/u.d,cur,Math.abs(v/u.d)>=10?0:1)};
const fmtPct=v=>isNum(v)?(Math.abs(v)>=100?v.toFixed(0):v.toFixed(1))+'%':'—';
const axisPct=v=>(+v.toFixed(1))+'%';
const axisX=v=>(+v.toFixed(2))+'×';
function compact(v){if(!isNum(v))return'—';const a=Math.abs(v);const f=(x,s)=>(+x.toFixed(1)).toLocaleString()+s;if(a>=1e9)return f(v/1e9,'B');if(a>=1e6)return f(v/1e6,'M');if(a>=1e4)return f(v/1e3,'K');return(+v.toFixed(2)).toLocaleString()}
function fmtBy(kind,v,cur){if(!isNum(v))return'—';switch(kind){
  case'amt':return fmtAmt(v,cur);case'pct':return fmtPct(v);case'x':return v.toFixed(2)+'×';
  case'days':return Math.round(v)+' days';case'eps':return(SYM[cur]??'')+v.toFixed(2);
  case'cnt':return compact(v);default:return fmtNum(v,cur)}}
const fmtDate=d=>{const x=new Date(d+'T00:00:00Z');return isNaN(x)?d:x.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})};
const shortName=n=>String(n||'').replace(/\b(limited|ltd\.?|inc\.?|corporation|corp\.?|plc|\(sample data\))\b/gi,'').replace(/\s+/g,' ').trim();

/* ---------- periods ---------- */
function isIndian(co){const s=co.symbol||'';return /\.(NS|BO)$/i.test(s)||!!(co.info&&(co.info.currency==='INR'||co.info.financialCurrency==='INR'))}
function pmeta(date,indian){const d=new Date(date+'T00:00:00Z');const m=d.getUTCMonth()+1,y=d.getUTCFullYear();
  if(indian){const fy=m<=3?y:y+1,q=m>=4&&m<=6?1:m>=7&&m<=9?2:m>=10?3:4,yy=String(fy).slice(-2);return{fy,q,fyL:'FY'+yy,qL:`Q${q} FY${yy}`}}
  const q=Math.ceil(m/3);return{fy:y,q,fyL:'FY'+y,qL:`Q${q} ${y}`}}
const qMonths=q=>['Apr–Jun','Jul–Sep','Oct–Dec','Jan–Mar'][q-1];
function align(src,vals,target){const ts=src.map(p=>+new Date(p));return target.map(p=>{const t=+new Date(p);let best=-1,bd=Infinity;ts.forEach((x,j)=>{const d=Math.abs(x-t);if(d<bd){bd=d;best=j}});return best>=0&&bd<=20*864e5?vals[best]:null})}
function yoyIdx(M,i){if(i==null||i<0)return null;const t=+new Date(M.periods[i]);for(let j=i-1;j>=0;j--){const d=(t-new Date(M.periods[j]))/864e5;if(Math.abs(d-365)<=25)return j;if(d>400)break}return null}
const cmpIdx=(M,i)=>{const y=yoyIdx(M,i);return y!=null?y:(i>0?i-1:null)};

/* ---------- line-item dictionary (Yahoo + Indian/Screener names) ---------- */
const METRICS={
 revenue:{st:['income'],n:['Total Revenue','Operating Revenue','Revenue From Operations','Revenue From Operations Net','Revenue','Net Sales','Sales','Total Income From Operations','Income From Operations','Turnover']},
 cogs:{st:['income'],n:['Cost Of Revenue','Reconciled Cost Of Revenue','Cost Of Goods Sold','Cost Of Sales','Cost Of Materials Consumed','Material Cost']},
 grossProfit:{st:['income'],n:['Gross Profit']},
 totalExp:{st:['income'],n:['Total Expenses','Expenses','Total Expenditure']},
 ebitda:{st:['income'],n:['EBITDA','Normalized EBITDA','Operating Profit','PBDIT']},
 dep:{st:['income','cashflow'],n:['Reconciled Depreciation','Depreciation And Amortization','Depreciation Amortization Depletion','Depreciation And Amortisation','Depreciation']},
 ebit:{st:['income'],n:['EBIT','Operating Income','Total Operating Income As Reported','PBIT']},
 interest:{st:['income'],n:['Interest Expense','Interest Expense Non Operating','Finance Costs','Finance Cost','Interest']},
 pbt:{st:['income'],n:['Pretax Income','Profit Before Tax','PBT']},
 tax:{st:['income'],n:['Tax Provision','Tax Expense','Total Tax Expense','Tax']},
 netIncome:{st:['income'],n:['Net Income Common Stockholders','Net Income','Net Income From Continuing Operation Net Minority Interest','Profit After Tax','Net Profit','PAT','Profit For The Year','Profit For The Period']},
 eps:{st:['income'],n:['Diluted EPS','Basic EPS','EPS','EPS In Rs','Earnings Per Share']},
 totalAssets:{st:['balance'],n:['Total Assets']},
 totalLiab:{st:['balance'],n:['Total Liabilities Net Minority Interest','Total Liabilities']},
 equity:{st:['balance'],n:['Stockholders Equity','Common Stock Equity','Total Equity Gross Minority Interest','Total Equity','Shareholders Funds','Net Worth']},
 equityCap:{st:['balance'],n:['Equity Share Capital','Equity Capital','Share Capital']},
 reserves:{st:['balance'],n:['Reserves','Reserves And Surplus','Other Equity']},
 currentAssets:{st:['balance'],n:['Current Assets','Total Current Assets']},
 currentLiab:{st:['balance'],n:['Current Liabilities','Total Current Liabilities']},
 inventory:{st:['balance'],n:['Inventory','Inventories']},
 receivables:{st:['balance'],n:['Accounts Receivable','Receivables','Trade Receivables','Current Trade Receivables','Sundry Debtors','Debtors']},
 payables:{st:['balance'],n:['Accounts Payable','Payables','Trade Payables','Current Trade Payables','Sundry Creditors','Creditors']},
 cash:{st:['balance'],n:['Cash And Cash Equivalents','Cash Cash Equivalents And Short Term Investments','Cash Financial','Cash And Bank Balances','Cash Equivalents']},
 debt:{st:['balance'],n:['Total Debt','Borrowings','Total Borrowings']},
 ncBorrow:{st:['balance'],n:['Non Current Borrowings']},curBorrow:{st:['balance'],n:['Current Borrowings']},
 ppe:{st:['balance'],n:['Net PPE','Fixed Assets','Property Plant And Equipment','Net Block']},
 investments:{st:['balance'],n:['Investments And Advances','Investments','Long Term Equity Investment']},
 ocf:{st:['cashflow'],n:['Operating Cash Flow','Cash Flow From Continuing Operating Activities','Cash From Operating Activity','Net Cash From Operating Activities']},
 icf:{st:['cashflow'],n:['Investing Cash Flow','Cash Flow From Continuing Investing Activities','Cash From Investing Activity','Net Cash From Investing Activities']},
 fincf:{st:['cashflow'],n:['Financing Cash Flow','Cash Flow From Continuing Financing Activities','Cash From Financing Activity','Net Cash From Financing Activities']},
 capex:{st:['cashflow'],n:['Capital Expenditure','Purchase Of PPE','Capital Expenditure Reported','Purchase Of Fixed Assets']},
 fcf:{st:['cashflow'],n:['Free Cash Flow']},
 dividends:{st:['cashflow'],n:['Cash Dividends Paid','Common Stock Dividend Paid','Dividends Paid','Dividend Paid']},
 netCashFlow:{st:['cashflow'],n:['Changes In Cash','Net Cash Flow']},
};
const KEYNORMS=[...new Set(Object.values(METRICS).flatMap(d=>d.n.map(norm)))];
function findItem(b,names){if(!b||!b.items)return null;const keys=Object.keys(b.items).filter(k=>!k.includes('%'));const nk=keys.map(norm);
  for(const n of names){const j=nk.indexOf(norm(n));if(j>=0)return b.items[keys[j]]}
  if(b.fuzzy)for(const n of names){const t=norm(n);if(t.length<4)continue;const j=nk.findIndex(k=>k.startsWith(t));if(j>=0)return b.items[keys[j]]}
  return null}

/* ---------- ratio definitions ---------- */
const GROUPS=[['Profitability','💰'],['Liquidity','💧'],['Solvency','🏗️'],['Efficiency','⚙️'],['Cash Flow','💵'],['Growth','🚀']];
const R=(k,g,n,kind,f,calc,band,dir,tip)=>({k,g,n,kind,f,calc,band,dir,tip});
const yoyG=key=>(m,i,M)=>{const j=yoyIdx(M,i);return j==null?null:growth(m[key][i],m[key][j])};
const RATIOS=[
 R('grossMargin','Profitability','Gross Profit Margin','pct','Gross Profit ÷ Revenue × 100',(m,i)=>pc(m.grossProfit[i],m.revenue[i]),[20,40],1,'Share of revenue left after direct costs.'),
 R('ebitdaMargin','Profitability','EBITDA Margin','pct','EBITDA ÷ Revenue × 100',(m,i)=>pc(m.ebitda[i],m.revenue[i]),[10,20],1,'Operating profitability before depreciation, interest and tax.'),
 R('opMargin','Profitability','Operating (EBIT) Margin','pct','EBIT ÷ Revenue × 100',(m,i)=>pc(m.ebit[i],m.revenue[i]),[8,15],1,'Core operating profitability after depreciation.'),
 R('netMargin','Profitability','Net Profit Ratio','pct','Profit for the year ÷ Revenue from operations × 100',(m,i)=>pc(m.netIncome[i],m.revenue[i]),[5,10],1,'Profit kept from every 100 of sales.'),
 R('roe','Profitability','Return on Equity (ROE)','pct','Net Profit (annualised) ÷ Shareholders’ Equity × 100',(m,i,M)=>m.equity[i]>0?pc(mul(m.netIncome[i],M.A),m.equity[i]):null,[10,15],1,'Return earned on shareholders’ funds (closing balance).'),
 R('roa','Profitability','Return on Assets (ROA)','pct','Net Profit (annualised) ÷ Total Assets × 100',(m,i,M)=>pc(mul(m.netIncome[i],M.A),m.totalAssets[i]),[4,8],1,'How efficiently total assets generate profit.'),
 R('roce','Profitability','Return on Capital Employed','pct','EBIT (annualised) ÷ (Total Assets − Current Liabilities) × 100',(m,i,M)=>pc(mul(m.ebit[i],M.A),sub(m.totalAssets[i],m.currentLiab[i])),[10,15],1,'Return on all long-term capital (debt + equity).'),
 R('effTax','Profitability','Effective Tax Rate','pct','Tax ÷ Profit Before Tax × 100',(m,i)=>m.pbt[i]>0?pc(m.tax[i],m.pbt[i]):null,null,0,'Actual tax burden on pre-tax profit.'),
 R('currentRatio','Liquidity','Current Ratio','x','Current Assets ÷ Current Liabilities',(m,i)=>rt(m.currentAssets[i],m.currentLiab[i]),[1,1.5],1,'Ability to meet short-term obligations.'),
 R('quickRatio','Liquidity','Quick (Acid-test) Ratio','x','(Current Assets − Inventory) ÷ Current Liabilities',(m,i)=>rt(sub(m.currentAssets[i],isNum(m.inventory[i])?m.inventory[i]:0),m.currentLiab[i]),[0.7,1],1,'Liquidity excluding inventory.'),
 R('cashRatio','Liquidity','Cash Ratio','x','Cash & Equivalents ÷ Current Liabilities',(m,i)=>rt(m.cash[i],m.currentLiab[i]),[0.2,0.5],1,'Most conservative liquidity test.'),
 R('workingCapital','Liquidity','Net Working Capital','amt','Current Assets − Current Liabilities',(m,i)=>m.workingCapital[i],null,0,'Short-term funding cushion.'),
 R('debtEquity','Solvency','Debt-Equity Ratio','x','Borrowings (incl. lease liabilities) ÷ Total equity',(m,i)=>m.equity[i]>0?rt(m.debt[i],m.equity[i]):null,[0.5,1],-1,'Financial leverage — lower is safer.'),
 R('debtAssets','Solvency','Debt to Assets','x','Total Debt ÷ Total Assets',(m,i)=>rt(m.debt[i],m.totalAssets[i]),[0.3,0.5],-1,'Share of assets funded by debt.'),
 R('interestCover','Solvency','Interest Coverage','x','EBIT ÷ Interest Expense',(m,i)=>absN(m.interest[i])>0?rt(m.ebit[i],Math.abs(m.interest[i])):null,[2,4],1,'Times operating profit covers interest.'),
 R('netDebtEbitda','Solvency','Net Debt / EBITDA','x','(Debt − Cash) ÷ EBITDA (annualised)',(m,i,M)=>rt(m.netDebt[i],mul(m.ebitda[i],M.A)),[1,3],-1,'Years of EBITDA needed to repay net debt (negative = net cash).'),
 R('equityMultiplier','Solvency','Equity Multiplier','x','Total Assets ÷ Shareholders’ Equity',(m,i)=>m.equity[i]>0?rt(m.totalAssets[i],m.equity[i]):null,null,0,'DuPont leverage component.'),
 R('assetTurnover','Efficiency','Asset Turnover','x','Revenue (annualised) ÷ Total Assets',(m,i,M)=>rt(mul(m.revenue[i],M.A),m.totalAssets[i]),[0.5,1],1,'Revenue generated per unit of assets.'),
 R('fixedAssetTurnover','Efficiency','Fixed Asset Turnover','x','Revenue (annualised) ÷ Net Fixed Assets',(m,i,M)=>rt(mul(m.revenue[i],M.A),m.ppe[i]),[1,2],1,'Productivity of plant & equipment.'),
 R('invTurnover','Efficiency','Inventory Turnover','x','Cost of Revenue (annualised) ÷ Inventory',(m,i,M)=>rt(mul(m.cogs[i],M.A),m.inventory[i]),[4,8],1,'How many times stock is sold in a year.'),
 R('invDays','Efficiency','Inventory Days','days','Inventory ÷ Cost of Revenue × days',(m,i,M)=>mul(rt(m.inventory[i],m.cogs[i]),M.D),[60,120],-1,'Days of stock on hand.'),
 R('debtorDays','Efficiency','Trade Receivable Days','days','Trade receivables ÷ Revenue from operations × days',(m,i,M)=>mul(rt(m.receivables[i],m.revenue[i]),M.D),[60,90],-1,'Average collection period.'),
 R('payableDays','Efficiency','Trade Payable Days','days','Trade payables ÷ Cost of revenue × days',(m,i,M)=>mul(rt(m.payables[i],m.cogs[i]),M.D),null,0,'Average payment period to suppliers.'),
 R('ccc','Efficiency','Cash Conversion Cycle','days','Inventory Days + Debtor Days − Payable Days',(m,i,M)=>{const a=mul(rt(m.inventory[i],m.cogs[i]),M.D)??0,b=mul(rt(m.receivables[i],m.revenue[i]),M.D),c=mul(rt(m.payables[i],m.cogs[i]),M.D)??0;return isNum(b)?a+b-c:null},[60,120],-1,'Days cash is locked in operations.'),
 R('ocfToNI','Cash Flow','Cash Conversion (OCF ÷ Net Profit)','x','Operating Cash Flow ÷ Net Profit',(m,i)=>m.netIncome[i]>0?rt(m.ocf[i],m.netIncome[i]):null,[0.8,1],1,'Quality of earnings — are profits backed by cash?'),
 R('fcfMargin','Cash Flow','Free Cash Flow Margin','pct','Free Cash Flow ÷ Revenue × 100',(m,i)=>pc(m.fcf[i],m.revenue[i]),[0,8],1,'Cash left after capex, per 100 of revenue.'),
 R('capexToRev','Cash Flow','Capex Intensity','pct','Capital Expenditure ÷ Revenue × 100',(m,i)=>pc(absN(m.capex[i]),m.revenue[i]),null,0,'Reinvestment in fixed assets.'),
 R('ocfToCL','Cash Flow','Cash Flow to Current Liabilities','x','Operating Cash Flow (annualised) ÷ Current Liabilities',(m,i,M)=>rt(mul(m.ocf[i],M.A),m.currentLiab[i]),[0.4,1],1,'Ability to pay short-term dues from operating cash.'),
 R('divPayout','Cash Flow','Dividend Payout','pct','Dividends Paid ÷ Net Profit × 100',(m,i)=>m.netIncome[i]>0?pc(absN(m.dividends[i]),m.netIncome[i]):null,null,0,'Share of profit returned to shareholders.'),
 R('revGrowth','Growth','Revenue Growth (YoY)','pct','(Revenue − Revenue a year ago) ÷ Revenue a year ago',yoyG('revenue'),[0,10],1,'Top-line momentum.'),
 R('ebitdaGrowth','Growth','EBITDA Growth (YoY)','pct','Change in EBITDA vs a year ago',yoyG('ebitda'),[0,10],1,'Operating profit momentum.'),
 R('niGrowth','Growth','Net Profit Growth (YoY)','pct','Change in Net Profit vs a year ago',yoyG('netIncome'),[0,10],1,'Bottom-line momentum.'),
 R('epsGrowth','Growth','EPS Growth (YoY)','pct','Change in EPS vs a year ago',yoyG('eps'),[0,10],1,'Per-share earnings momentum.'),
];
const RMAP=Object.fromEntries(RATIOS.map(d=>[d.k,d]));
function status(d,v){if(!d||!d.band||!isNum(v))return null;const[lo,hi]=d.band;return d.dir>0?(v>=hi?'good':v>=lo?'ok':'weak'):(v<=lo?'good':v<=hi?'ok':'weak')}
const ST_LABEL={good:'🟢 Strong',ok:'🟡 Fair',weak:'🔴 Weak'};
const stChip=s=>s?`<span class="st ${s}">${ST_LABEL[s]}</span>`:'';
function benchText(d){if(!d.band)return'Context-dependent';const[lo,hi]=d.band,u=d.kind==='pct'?'%':d.kind==='x'?'×':d.kind==='days'?' d':'';return d.dir>0?`≥ ${hi}${u} strong · ${lo}–${hi}${u} fair · < ${lo}${u} weak`:`≤ ${lo}${u} strong · ${lo}–${hi}${u} fair · > ${hi}${u} weak`}
const CORE=['netMargin','ebitdaMargin','roe','roce','currentRatio','debtEquity','interestCover','ocfToNI','revGrowth','assetTurnover'];
function health(M,i){const sc={good:100,ok:60,weak:20};let s=0,n=0;const cnt={good:0,ok:0,weak:0};
  CORE.forEach(k=>{const st=status(RMAP[k],M.r[k][i]);if(st){s+=sc[st];n++;cnt[st]++}});
  if(n<3)return null;const score=Math.round(s/n);
  return{score,cnt,n,label:score>=75?'Strong 💪':score>=58?'Healthy 👍':score>=42?'Watch 👀':'Weak ⚠️'}}

/* ---------- financial model ---------- */
const MC=new Map();
const clearModels=sym=>{for(const k of [...MC.keys()])if(k.startsWith(sym+'|'))MC.delete(k);if(typeof S3_MEMO!=='undefined')S3_MEMO.clear()};
function getModel(sym,freq=S.freq){const k=sym+'|'+freq;if(!MC.has(k))MC.set(k,buildModel(S.companies[sym],freq));return MC.get(k)}
function buildModel(co,freq){
  const F=co&&co[freq];if(!F)return null;
  const base=[F.income,F.cashflow,F.balance].find(b=>b&&b.periods&&b.periods.length);if(!base)return null;
  let periods=base.periods.slice();const raw={};
  for(const[k,d]of Object.entries(METRICS)){let arr=null;
    for(const st of d.st){const b=F[st],v=findItem(b,d.n);if(v){const a=align(b.periods,v,periods);if(a.some(isNum)){arr=a;break}}}
    raw[k]=arr||periods.map(()=>null)}
  const keep=periods.map((_,i)=>['revenue','netIncome','ocf','totalAssets'].some(k=>isNum(raw[k][i])));
  periods=periods.filter((_,i)=>keep[i]);if(!periods.length)return null;
  const m={};for(const k in raw)m[k]=raw[k].filter((_,i)=>keep[i]);
  const n=periods.length,each=f=>Array.from({length:n},(_,i)=>f(i));
  const fill=(k,f)=>{m[k]=m[k].map((v,i)=>isNum(v)?v:f(i))};
  fill('grossProfit',i=>sub(m.revenue[i],m.cogs[i]));
  fill('ebit',i=>isNum(m.pbt[i])?m.pbt[i]+(isNum(m.interest[i])?Math.abs(m.interest[i]):0):sub(m.ebitda[i],absN(m.dep[i])));
  fill('ebitda',i=>isNum(m.ebit[i])&&isNum(m.dep[i])?m.ebit[i]+Math.abs(m.dep[i]):null);
  fill('equity',i=>addN(m.equityCap[i],m.reserves[i])??sub(m.totalAssets[i],m.totalLiab[i]));
  m.totalLiab=m.totalLiab.map((v,i)=>{const ta=m.totalAssets[i],eq=m.equity[i];if(isNum(v)&&isNum(ta)&&isNum(eq)&&Math.abs(v-ta)<Math.abs(ta)*0.005)return ta-eq;return isNum(v)?v:sub(ta,eq)});
  fill('debt',i=>addN(m.ncBorrow[i],m.curBorrow[i])??m.ncBorrow[i]??m.curBorrow[i]);
  fill('fcf',i=>isNum(m.ocf[i])&&isNum(m.capex[i])?m.ocf[i]-Math.abs(m.capex[i]):null);
  fill('netCashFlow',i=>addN(m.ocf[i],m.icf[i],m.fincf[i]));
  m.netDebt=each(i=>isNum(m.debt[i])?m.debt[i]-(isNum(m.cash[i])?m.cash[i]:0):null);
  m.workingCapital=each(i=>sub(m.currentAssets[i],m.currentLiab[i]));
  const info=co.info||{},cur=info.financialCurrency||info.currency||'INR',indian=isIndian(co),metas=periods.map(p=>pmeta(p,indian));
  const M={co,freq,periods,m,cur,indian,metas,labels:metas.map(x=>freq==='annual'?x.fyL:x.qL),A:freq==='quarterly'?4:1,D:freq==='quarterly'?91:365,r:{}};
  for(const d of RATIOS)M.r[d.k]=each(i=>{try{const v=d.calc(m,i,M);return isNum(v)?v:null}catch(e){return null}});
  return M}
const activeCo=()=>S.active&&S.companies[S.active]||null;
function selIndex(M){if(!M)return-1;if(S.selDate){const j=M.periods.indexOf(S.selDate);if(j>=0)return j}return M.periods.length-1}
function ctx(){const co=activeCo();if(!co)return null;const M=getModel(S.active);if(!M)return{co,M:null};
  const i=selIndex(M),y=cmpIdx(M,i);
  return{co,M,i,y,m:M.m,r:M.r,c:M.cur,vs:y!=null?M.labels[y]:'',sub:`${esc(co.name)} · ${M.labels[i]} (${fmtDate(M.periods[i])}) · ${curLabel(M.cur)}`}}
function curLabel(c){return`Figures in ${SYM[c]||c} ${unitOf(c).n} · ${S.freq==='quarterly'?'Quarterly':'Annual'}`}

/* ---------- auto-generated insights ---------- */
function insightsFor(M,i,sec){
  const out=[],m=M.m,r=M.r,c=M.cur,y=cmpIdx(M,i),vs=y!=null?M.labels[y]:null;
  const P=(t,ic,x)=>out.push({t,ic,x}),f=(k,v)=>fmtBy(k,v,c);
  const pp=k=>y!=null&&isNum(r[k][i])&&isNum(r[k][y])?r[k][i]-r[k][y]:null;
  const has=s=>sec==='overview'||sec===s;
  if(has('pl')){
    const g=y!=null?growth(m.revenue[i],m.revenue[y]):null,ng=y!=null?growth(m.netIncome[i],m.netIncome[y]):null;
    if(isNum(g))P(g>=0?'pos':'neg',g>=0?'📈':'📉',`Revenue ${g>=0?'grew':'fell'} <b>${fmtPct(Math.abs(g))}</b> vs ${vs} to <b>${f('amt',m.revenue[i])}</b>.`);
    if(isNum(ng))P(ng>=0?'pos':'neg',ng>=0?'💹':'🔻',`Net profit ${ng>=0?'rose':'declined'} <b>${fmtPct(Math.abs(ng))}</b> to <b>${f('amt',m.netIncome[i])}</b>.`);
    if(isNum(g)&&isNum(ng)){if(ng-g>3)P('pos','⚡','Profit is growing faster than revenue — positive operating leverage / margin expansion.');else if(g-ng>3)P('neg','⚠️','Profit is growing slower than revenue — costs are rising faster than sales.')}
    const d=pp('netMargin');if(isNum(d)&&Math.abs(d)>=0.3)P(d>0?'pos':'neg',d>0?'🟢':'🔴',`Net margin ${d>0?'expanded':'contracted'} by <b>${Math.abs(d).toFixed(1)} pp</b> to ${fmtPct(r.netMargin[i])}.`);
    const prior=m.revenue.slice(0,i).filter(isNum);if(prior.length>=2&&m.revenue[i]>Math.max(...prior))P('pos','🏆',`Highest revenue in the ${prior.length+1} periods shown.`);
    if(sec==='pl'){
      const e=pp('ebitdaMargin');if(isNum(e)&&Math.abs(e)>=0.3)P(e>0?'pos':'neg','⚙️',`EBITDA margin ${e>0?'improved':'slipped'} ${Math.abs(e).toFixed(1)} pp to ${fmtPct(r.ebitdaMargin[i])}.`);
      const t=r.effTax[i];if(isNum(t))P(t<15||t>35?'neu':'pos','🧾',`Effective tax rate is ${fmtPct(t)}${t<15?' — unusually low; check for exemptions or one-offs':t>35?' — unusually high; check for one-offs':''}.`);
      const ib=pc(absN(m.interest[i]),m.ebit[i]);if(isNum(ib))P(ib>25?'neg':'pos','🏦',`Interest absorbs ${fmtPct(ib)} of operating profit (EBIT).`);
    }}
  if(has('bs')){
    const cr=r.currentRatio[i];if(isNum(cr))P(cr>=1.5?'pos':cr>=1?'neu':'neg','💧',`Current ratio of <b>${cr.toFixed(2)}×</b> — ${cr>=1.5?'comfortable liquidity':cr>=1?'adequate liquidity':'current liabilities exceed current assets; watch liquidity'}.`);
    const de=r.debtEquity[i];if(isNum(de))P(de<=0.5?'pos':de<=1?'neu':'neg',de<0.1?'🛡️':'🏗️',de<0.1?`Virtually debt-free (Debt/Equity ${de.toFixed(2)}×).`:`Debt/Equity at <b>${de.toFixed(2)}×</b> — ${de<=0.5?'conservative':de<=1?'moderate':'high'} leverage.`);
    const nd=m.netDebt[i];if(isNum(nd)&&nd<0)P('pos','💰',`Net cash position of <b>${f('amt',-nd)}</b> (cash exceeds debt).`);
    if(sec==='bs'){
      const eg=y!=null?growth(m.equity[i],m.equity[y]):null;if(isNum(eg))P(eg>=0?'pos':'neg','🏛️',`Net worth ${eg>=0?'increased':'decreased'} ${fmtPct(Math.abs(eg))} to ${f('amt',m.equity[i])}.`);
      const dd=r.debtorDays[i],dp=y!=null?r.debtorDays[y]:null;if(isNum(dd)&&isNum(dp)&&Math.abs(dd-dp)>=3)P(dd<dp?'pos':'neg','⏱️',`Debtor days ${dd<dp?'improved':'worsened'} from ${Math.round(dp)} to ${Math.round(dd)} days.`);
      const wc=m.workingCapital[i];if(isNum(wc)&&wc<0)P('neu','🔄',`Negative working capital of ${f('amt',wc)} — common for businesses paid in advance, risky otherwise.`);
    }}
  if(has('cf')){
    const q=r.ocfToNI[i];if(isNum(q))P(q>=1?'pos':q>=0.7?'neu':'neg','💵',q>=1?`Strong cash conversion — operating cash flow is <b>${q.toFixed(2)}×</b> net profit.`:q>=0.7?`Reasonable cash conversion (OCF ${q.toFixed(2)}× net profit).`:`Weak cash conversion — OCF only <b>${q.toFixed(2)}×</b> net profit; check receivables/inventory build-up.`);
    if(isNum(m.fcf[i]))P(m.fcf[i]>=0?'pos':'neg','🌊',`Free cash flow ${m.fcf[i]>=0?'positive':'negative'} at <b>${f('amt',m.fcf[i])}</b>${isNum(r.fcfMargin[i])?` (${fmtPct(r.fcfMargin[i])} of revenue)`:''}.`);
    if(sec==='cf'){
      const cx=r.capexToRev[i];if(isNum(cx))P('neu','🏭',`Capex intensity of ${fmtPct(cx)} of revenue — ${cx>10?'heavy investment phase':cx>4?'steady reinvestment':'asset-light business'}.`);
      const dp=r.divPayout[i];if(isNum(dp))P('pos','🎁',`Paid ${fmtPct(dp)} of profit as dividends.`);
      if(isNum(m.fincf[i]))P('neu','🏦',m.fincf[i]>0?`Net inflow from financing (${f('amt',m.fincf[i])}) — the company raised fresh debt/equity.`:`Net outflow on financing (${f('amt',m.fincf[i])}) — repaying debt and/or rewarding shareholders.`);
    }}
  if(has('ratios')){
    const roe=r.roe[i],roce=r.roce[i];
    if(isNum(roe))P(status(RMAP.roe,roe)==='weak'?'neg':'pos','🎯',`ROE of <b>${fmtPct(roe)}</b>${isNum(roce)?` and ROCE of <b>${fmtPct(roce)}</b>`:''}${M.A>1?' (annualised)':''}.`);
    if(sec==='ratios'&&y!=null){
      const comps=[['Net margin','netMargin'],['Asset turnover','assetTurnover'],['Equity multiplier','equityMultiplier']].map(([n,k])=>[n,growth(r[k][i],r[k][y])]).filter(x=>isNum(x[1]));
      if(comps.length){comps.sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));const[n,v]=comps[0];P('neu','🧩',`DuPont: the biggest driver of ROE change vs ${vs} was <b>${n}</b> (${v>=0?'+':''}${v.toFixed(1)}%).`)}
    }
    const H=health(M,i);if(H&&sec==='ratios')P(H.score>=58?'pos':H.score>=42?'neu':'neg','🩺',`Overall financial health score: <b>${H.score}/100</b> (${H.label}).`);
  }
  return out}
const insightsHTML=list=>list.length?`<ul class="insights">${list.map((x,k)=>`<li class="${x.t}" style="animation-delay:${k*50}ms"><span class="ii">${x.ic}</span><span>${x.x}</span></li>`).join('')}</ul>`:'<div class="empty">🤔 Not enough data to generate insights for this period.</div>';
/* ======================= 2. Chart helpers (charts themselves: static/charts.js, Apache ECharts) ======================= */
function spark(data,color='var(--accent)'){const v=data.map((x,i)=>[i,x]).filter(p=>isNum(p[1]));if(v.length<2)return'';const n=(data.length-1)||1,lo=Math.min(...v.map(p=>p[1])),hi=Math.max(...v.map(p=>p[1])),sy=y=>hi===lo?15:27-(y-lo)/(hi-lo)*23;
  const pts=v.map(([i,y])=>`${(i/n*100).toFixed(2)},${sy(y).toFixed(2)}`);
  return`<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"><path d="M${pts.join('L')}L${(lastOf(v)[0]/n*100).toFixed(2)},30L${(v[0][0]/n*100).toFixed(2)},30Z" style="fill:${color};fill-opacity:.12"/><path d="M${pts.join('L')}" style="fill:none;stroke:${color};stroke-width:1.8" vector-effect="non-scaling-stroke"/></svg>`}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
const downloadText=(text,name,type='text/csv')=>downloadBlob(new Blob([text],{type:type+';charset=utf-8'}),name);
const toCSV=rows=>'﻿'+rows.map(r=>r.map(c=>{const s=c==null?'':String(c);return/[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}).join(',')).join('\n');
/* ======================= 3. Cards, layout, drag & drop ======================= */
const CHARTS=new Map();
function chartCard(id,title,spec,o={}){CHARTS.set(id,spec);return{id,title,span:o.span||6,chart:true,sw:!!o.sw,body:(o.pre||'')+`<div class="chart" data-chart="${id}"></div>`+(o.note?`<div class="note">${o.note}</div>`:'')}}
const card=(id,title,body,o={})=>({id,title,body,span:o.span||6,chart:false});
function grid(key,cards){
  const lay=ls.get('ca-lay-'+key,{}),order=lay.order||[],spans=lay.span||{};
  cards=cards.filter(Boolean);
  if(order.length)cards.sort((a,b)=>{const x=order.indexOf(a.id),y=order.indexOf(b.id);return(x<0?999:x)-(y<0?999:y)});
  return`<div class="grid" data-grid="${key}">${cards.map((c,k)=>{const sp=c.chart?CHARTS.get(c.id):null;
    const types=c.sw?['bar','line','area'].map(t=>`<button class="ib${sp.type===t?' on':''}" data-act="type" data-t="${t}" title="${t} chart">${{bar:'📊',line:'📈',area:'🏔️'}[t]}</button>`).join(''):'';
    return`<div class="card span-${spans[c.id]||c.span}" data-id="${c.id}" style="animation-delay:${k*45}ms">
      <div class="card-head"><span class="drag-handle" title="Drag to rearrange">⠿</span><h3 title="${esc(c.title)}">${c.title}</h3>
      <div class="card-actions">${types}${c.chart?`<button class="ib" data-act="max" title="Expand">⛶</button><button class="ib" data-act="png" title="Download PNG">⬇️</button>`:''}<button class="ib" data-act="span" title="Resize card">↔️</button></div></div>
      <div class="card-body">${c.body}</div></div>`}).join('')}</div>`}
function saveLayout(g){const key=g.dataset.grid,lay=ls.get('ca-lay-'+key,{});lay.order=$$(':scope>.card',g).map(c=>c.dataset.id);ls.set('ca-lay-'+key,lay)}
function enableDnD(g){if(!window.Sortable||g._sortable)return;
  g._sortable=Sortable.create(g,{handle:'.drag-handle',animation:220,ghostClass:'dragging',
    onEnd:e=>{if(e.oldIndex!==e.newIndex){saveLayout(g);toast('🧩 Layout saved','ok',1500)}}})}
function cycleSpan(c){const g=c.parentNode,key=g.dataset.grid,cur=+(c.className.match(/span-(\d+)/)||[0,6])[1],nx={4:6,6:8,8:12,12:4}[cur]||6;
  c.className=c.className.replace(/span-\d+/,'span-'+nx);const lay=ls.get('ca-lay-'+key,{});lay.span=lay.span||{};lay.span[c.dataset.id]=nx;ls.set('ca-lay-'+key,lay)}
function mountCharts(root,anim=true){$$('[data-chart]',root).forEach(el=>{const sp=CHARTS.get(el.dataset.chart);if(sp)Charts.draw(el,sp,anim)})}
function kpi({icon,label,v,kind='amt',cur,chg,chgKind='pct',vs,spark:sp,good=1}){
  let ch='<span class="vs">—</span>';
  if(isNum(chg)){const up=chg>=0,tone=(up?1:-1)*good>0?'up':'down';ch=`<span class="chg ${tone}">${up?'▲':'▼'} ${chgKind==='pp'?Math.abs(chg).toFixed(1)+' pp':fmtPct(Math.abs(chg))}</span><span class="vs">vs ${esc(vs)}</span>`}
  return`<div class="kpi"><div class="kpi-top"><span class="kpi-ico">${icon}</span><span>${esc(label)}</span></div><div class="kpi-val" data-count="${isNum(v)?v:''}" data-kind="${kind}" data-cur="${cur}" title="${esc(fmtBy(kind,v,cur))}">${fmtBy(kind,v,cur)}</div><div class="kpi-foot">${ch}</div>${sp?spark(sp):''}</div>`}
function kpiRow(list){return`<div class="kpis">${list.join('')}</div>`}
function animateCounts(root){if(document.documentElement.classList.contains('no-motion')||matchMedia('(prefers-reduced-motion: reduce)').matches)return;$$('[data-count]',root).forEach(el=>{const t=parseFloat(el.dataset.count);if(!isNum(t))return;const k=el.dataset.kind,c=el.dataset.cur,t0=performance.now();
  const step=now=>{const p=Math.min((now-t0)/800,1),e=1-Math.pow(1-p,3);el.textContent=fmtBy(k,t*e,c);if(p<1)requestAnimationFrame(step)};requestAnimationFrame(step)})}
const vhead=(title,sub,extra='')=>`<div class="view-head"><div><h2>${title}</h2><p>${sub}</p></div><div class="vh-tools">${extra}<button class="btn ghost sm" data-act="reset-layout" title="Restore the default chart layout">↺ Reset layout</button></div></div>`;
const chgK=(M,m,k,i,y,good=1)=>({v:m[k][i],cur:M.cur,chg:y!=null?growth(m[k][i],m[k][y]):null,vs:y!=null?M.labels[y]:'',spark:m[k].slice(0,i+1),good});

/* ======================= 4. Views ======================= */
const QUICK=[['Reliance','RELIANCE.NS'],['TCS','TCS.NS'],['Infosys','INFY.NS'],['HDFC Bank','HDFCBANK.NS'],['ITC','ITC.NS'],['Asian Paints','ASIANPAINT.NS'],['Maruti Suzuki','MARUTI.NS'],['Sun Pharma','SUNPHARMA.NS'],['L&T','LT.NS'],['Titan','TITAN.NS']];
const LOCAL=[['Reliance Industries','RELIANCE.NS'],['Tata Consultancy Services','TCS.NS'],['HDFC Bank','HDFCBANK.NS'],['ICICI Bank','ICICIBANK.NS'],['Infosys','INFY.NS'],['Bharti Airtel','BHARTIARTL.NS'],['State Bank of India','SBIN.NS'],['ITC','ITC.NS'],['Hindustan Unilever','HINDUNILVR.NS'],['Larsen & Toubro','LT.NS'],['Kotak Mahindra Bank','KOTAKBANK.NS'],['Axis Bank','AXISBANK.NS'],['Bajaj Finance','BAJFINANCE.NS'],['Asian Paints','ASIANPAINT.NS'],['Maruti Suzuki','MARUTI.NS'],['HCL Technologies','HCLTECH.NS'],['Sun Pharmaceutical','SUNPHARMA.NS'],['Titan Company','TITAN.NS'],['UltraTech Cement','ULTRACEMCO.NS'],['Wipro','WIPRO.NS'],['Nestle India','NESTLEIND.NS'],['ONGC','ONGC.NS'],['NTPC','NTPC.NS'],['Power Grid Corporation','POWERGRID.NS'],['Mahindra & Mahindra','M&M.NS'],['Tata Steel','TATASTEEL.NS'],['JSW Steel','JSWSTEEL.NS'],['Adani Enterprises','ADANIENT.NS'],['Adani Ports','ADANIPORTS.NS'],['Coal India','COALINDIA.NS'],['Bajaj Finserv','BAJAJFINSV.NS'],['Bajaj Auto','BAJAJ-AUTO.NS'],['Hero MotoCorp','HEROMOTOCO.NS'],['Eicher Motors','EICHERMOT.NS'],["Dr. Reddy's Laboratories",'DRREDDY.NS'],['Cipla','CIPLA.NS'],["Divi's Laboratories",'DIVISLAB.NS'],['Tech Mahindra','TECHM.NS'],['Grasim Industries','GRASIM.NS'],['Britannia Industries','BRITANNIA.NS'],['Hindalco Industries','HINDALCO.NS'],['IndusInd Bank','INDUSINDBK.NS'],['Tata Consumer Products','TATACONSUM.NS'],['Apollo Hospitals','APOLLOHOSP.NS'],['Avenue Supermarts (DMart)','DMART.NS'],['Pidilite Industries','PIDILITIND.NS'],['Dabur India','DABUR.NS'],['Havells India','HAVELLS.NS'],['Vedanta','VEDL.NS'],['Indian Oil Corporation','IOC.NS'],['BPCL','BPCL.NS'],['GAIL India','GAIL.NS'],['DLF','DLF.NS'],['LTIMindtree','LTIM.NS'],['Tata Power','TATAPOWER.NS'],['Bharat Electronics','BEL.NS'],['Hindustan Aeronautics','HAL.NS'],['Apple','AAPL'],['Microsoft','MSFT']].map(([name,symbol])=>({name,symbol}));

function loadingView(){return`<div class="loading"><div class="spinner"></div><h3>⬇️ Downloading results for “${esc(S.loading)}”…</h3><p class="note">Fetching P&amp;L, Balance Sheet, Cash Flow (annual + quarterly) and market data</p><div class="skels">${'<div class="skel"></div>'.repeat(4)}</div><div class="skels">${'<div class="skel" style="height:260px"></div>'.repeat(2)}</div></div>`}
function vWelcome(){
  if(S.loading)return loadingView();
  const cached=(S.cached||[]).filter(c=>!S.companies[c.symbol]);
  const banner=!SERVER?`<div class="banner">🔴 <b>Can’t reach the server.</b> Check your internet connection and refresh the page. You can still explore the demo company and upload your own files.</div>`:'';
  return`<div class="welcome">${banner}<div class="wl-hero"><div class="wl-badge">📊</div><h1>Welcome to <span class="grad">Company Analyser</span></h1>
   <p>Download the latest published results of any listed company and get instant ratio analysis, section-wise insights and peer comparison — in one interactive dashboard.</p>
   <div class="wl-search"><div class="search"><span>🔍</span><input id="q2" autocomplete="off" placeholder="Type a company name — e.g. Infosys, Tata Steel, HDFC Bank"><div class="suggest" id="suggest2"></div></div><button class="btn primary" data-act="load-q2">🚀 Analyse</button></div>
   <div class="wl-quick"><span>⚡ Quick picks:</span>${QUICK.map(([n,s])=>`<span class="chip btnchip" data-act="load" data-q="${s}">${esc(n)}</span>`).join('')}</div>
   <div class="wl-actions"><button class="btn primary" data-act="load" data-q="DEMO">🎯 Explore the demo company</button><button class="btn" data-act="tab" data-tab="smart">📤 Upload your own data</button><button class="btn" data-act="tab" data-tab="guide">❓ How it works</button></div>
   ${cached.length?`<div class="wl-quick"><span>🕘 Recently analysed:</span>${cached.map(c=>`<span class="chip btnchip" data-act="load" data-q="${esc(c.symbol)}">${esc(shortName(c.name))}</span>`).join('')}</div>`:''}</div>
   <div class="features">${[['⬇️','Live results download','Annual & quarterly P&L, Balance Sheet and Cash Flow for NSE, BSE and global stocks.'],['🧮','30+ ratios','Profitability, liquidity, solvency, efficiency, cash-flow and growth — with traffic-light verdicts.'],['🧩','Section-wise analysis','Dedicated P&L, Balance Sheet and Cash Flow pages with auto-written insights.'],['⚖️','Peer comparison','Line up competitors side-by-side, with currency conversion and a 🏆 leader board.'],['🤖','Smart upload','Drop any CSV/Excel — columns are understood and the right charts are chosen automatically.'],['📱','Phone & desktop','Works in any browser — tap, pinch and add it to your home screen like an app.']].map(([i,t,d],k)=>`<div class="card-lite feat" style="animation-delay:${k*60}ms"><div class="fi">${i}</div><b>${t}</b><span>${d}</span></div>`).join('')}</div></div>`}
function noData(co){return`<div class="card-lite empty" style="padding:50px">📭 No ${S.freq} statements are published for <b>${esc(co.name)}</b>.<br><br><button class="btn primary" data-act="freq" data-f="${S.freq==='annual'?'quarterly':'annual'}">Switch to ${S.freq==='annual'?'Quarterly':'Annual'}</button></div>`}
const needCo=()=>{const c=ctx();if(!c)return vWelcome();if(!c.M)return noData(c.co);return null};

function heroHTML(co,M,i){
  const inf=co.info||{},pcur=inf.currency||M.cur,price=inf.currentPrice??inf.regularMarketPrice,ini=shortName(co.name).split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
  const latest=[...(co.quarterly?.income?.periods||[]),...(co.annual?.income?.periods||[])].sort().pop();
  const hi=inf.fiftyTwoWeekHigh,lo=inf.fiftyTwoWeekLow,pos=isNum(price)&&isNum(hi)&&isNum(lo)&&hi>lo?clamp((price-lo)/(hi-lo)*100,0,100):null;
  const lm=latest?pmeta(latest,M.indian):null,isQ=latest&&(co.quarterly?.income?.periods||[]).includes(latest);
  const dy=inf.dividendYield,dyv=isNum(dy)?(dy<0.2?dy*100:dy):null;
  return`<div class="card-lite hero"><div class="hero-main"><div class="logo-badge">${esc(ini||'📈')}</div><div style="min-width:0"><h1>${esc(co.name)}</h1>
    <div class="hero-sub">${esc(co.symbol)}${inf.exchange?' · '+esc(inf.exchange):''}${inf.sector?' · '+esc(inf.sector):''}${inf.industry?' › '+esc(inf.industry):''}</div>
    <div class="chips"><span class="chip acc">📅 Viewing ${M.labels[i]} · ${fmtDate(M.periods[i])}</span>${latest?`<span class="chip">🆕 Latest published: ${isQ?lm.qL:lm.fyL} (${fmtDate(latest)})</span>`:''}
    <span class="chip">💱 Financials in ${esc(M.cur)}</span><span class="chip">${co.fromCache?'🗄️ Cached':'🟢 Live'} · ${esc(co.source||'')}${co.fetchedAt?' · '+fmtDate(co.fetchedAt.slice(0,10)):''}</span></div></div></div>
    <div class="hero-stats">${isNum(price)?`<div class="hs"><span>💹 Share price</span><b>${SYM[pcur]||''}${fmtNum(price,pcur,2)}</b></div>`:''}
    ${isNum(inf.marketCap)?`<div class="hs"><span>🏢 Market cap</span><b>${fmtAmt(inf.marketCap,pcur)}</b></div>`:''}
    ${isNum(inf.trailingPE)?`<div class="hs"><span>🏷️ P/E</span><b>${inf.trailingPE.toFixed(1)}×</b></div>`:''}
    ${isNum(inf.priceToBook)?`<div class="hs"><span>📘 P/B</span><b>${inf.priceToBook.toFixed(1)}×</b></div>`:''}
    ${isNum(dyv)?`<div class="hs"><span>🎁 Div. yield</span><b>${dyv.toFixed(2)}%</b></div>`:''}
    ${pos!=null?`<div class="hs" style="grid-column:span 2"><span>📏 52-week range ${fmtNum(lo,pcur,0)} – ${fmtNum(hi,pcur,0)}</span><div class="range"><i style="left:${pos}%"></i></div></div>`:''}</div></div>
    ${inf.longBusinessSummary?`<details class="about"><summary>ℹ️ About the company</summary><p>${esc(inf.longBusinessSummary)}${inf.longBusinessSummary.length>=900?'…':''}</p></details>`:''}`}
function plSteps(m,i){const rev=m.revenue[i];if(!isNum(rev))return[];const st=[{label:'Revenue',value:rev,total:true}],e=m.ebitda[i];let run=rev;
  if(isNum(e)){st.push({label:'Operating costs',value:-(rev-e)});st.push({label:'EBITDA',value:e,total:true});run=e}
  const dep=absN(m.dep[i]),int=absN(m.interest[i]),pbt=m.pbt[i],tax=m.tax[i],ni=m.netIncome[i];
  if(isNum(dep)&&isNum(e)){st.push({label:'Depreciation',value:-dep});run-=dep}
  if(isNum(int)&&int>0){st.push({label:'Interest',value:-int});run-=int}
  if(isNum(pbt)){const o=pbt-run;if(Math.abs(o)>Math.abs(rev)*0.001)st.push({label:isNum(e)?'Other inc./exp.':'Expenses',value:o});st.push({label:'PBT',value:pbt,total:true});run=pbt}
  if(isNum(tax)){st.push({label:'Tax',value:-tax});run-=tax}
  if(isNum(ni)){const o=ni-run;if(Math.abs(o)>Math.abs(rev)*0.001)st.push({label:'Minority/other',value:o});st.push({label:'Net Profit',value:ni,total:true})}
  return st}
const amtSpec=(c,extra)=>Object.assign({fmt:axisAmt(c),tf:v=>fmtAmt(v,c)},extra);
function latestResultCard(co){
  const Q=getModel(co.symbol,'quarterly');if(!Q)return null;const li=Q.periods.length-1,y=yoyIdx(Q,li),q=li>0?li-1:null,c=Q.cur;
  const rows=[['💰 Revenue','m','revenue','amt'],['⚙️ EBITDA','m','ebitda','amt'],['🏆 Net Profit','m','netIncome','amt'],['🪙 EPS','m','eps','eps'],['📐 EBITDA Margin','r','ebitdaMargin','pct'],['📏 Net Margin','r','netMargin','pct']];
  const cell=(src,k,j,kind)=>j==null?'—':fmtBy(kind,Q[src][k][j],c);
  const chg=(src,k,j,kind)=>{if(j==null)return'—';const a=Q[src][k][li],b=Q[src][k][j];const d=kind==='pct'?sub(a,b):growth(a,b);if(!isNum(d))return'—';return`<span class="${d>=0?'pos-t':'neg-t'}">${d>=0?'▲':'▼'} ${kind==='pct'?Math.abs(d).toFixed(1)+' pp':fmtPct(Math.abs(d))}</span>`};
  return card('ov-latest',`🆕 Latest Quarterly Result — ${Q.labels[li]}`,`<div class="note" style="margin:0 0 8px">Quarter ended ${fmtDate(Q.periods[li])} · compared with same quarter last year (YoY) and previous quarter (QoQ)</div>
   <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Metric</th><th class="num">${Q.labels[li]}</th><th class="num">${y!=null?Q.labels[y]:'YoY'}</th><th class="num">YoY</th><th class="num">${q!=null?Q.labels[q]:'QoQ'}</th><th class="num">QoQ</th></tr></thead>
   <tbody>${rows.map(([n,src,k,kind])=>`<tr><td>${n}</td><td class="num"><b>${cell(src,k,li,kind)}</b></td><td class="num">${cell(src,k,y,kind)}</td><td class="num">${chg(src,k,y,kind)}</td><td class="num">${cell(src,k,q,kind)}</td><td class="num">${chg(src,k,q,kind)}</td></tr>`).join('')}</tbody></table></div>`,{span:6})}
function healthCard(id,M,i,span=4){const H=health(M,i);if(!H)return card(id,'🩺 Financial Health Score','<div class="empty">Not enough balance-sheet data to score this period.</div>',{span});
  CHARTS.set(id+'-g',{type:'gauge',value:H.score});
  return{...card(id,'🩺 Financial Health Score',`<div class="chart" data-chart="${id}-g"></div><div class="health-meta"><div class="hl">${H.label}</div><div class="counts"><span class="st good">🟢 ${H.cnt.good} strong</span><span class="st ok">🟡 ${H.cnt.ok} fair</span><span class="st weak">🔴 ${H.cnt.weak} weak</span></div><div class="note">Based on ${H.n} key ratios · <a href="#" data-act="tab" data-tab="ratios">see ratio analysis →</a></div></div>`,{span})}}

function vOverview(){const nd=needCo();if(nd)return nd;const{co,M,i,y,m,r,c,vs}=ctx();
  const k=[kpi({icon:'💰',label:'Revenue from operations',...chgK(M,m,'revenue',i,y)}),kpi({icon:'⚙️',label:'EBITDA',...chgK(M,m,'ebitda',i,y)}),kpi({icon:'🏆',label:'Profit for the year',...chgK(M,m,'netIncome',i,y)}),
    kpi({icon:'🪙',label:'EPS',kind:'eps',...chgK(M,m,'eps',i,y)}),
    kpi({icon:'📐',label:'Net Profit Ratio',kind:'pct',v:r.netMargin[i],cur:c,chg:y!=null?sub(r.netMargin[i],r.netMargin[y]):null,chgKind:'pp',vs,spark:r.netMargin.slice(0,i+1)}),
    kpi({icon:'🎯',label:'ROE'+(M.A>1?' (annualised)':''),kind:'pct',v:r.roe[i],cur:c,chg:y!=null?sub(r.roe[i],r.roe[y]):null,chgKind:'pp',vs,spark:r.roe.slice(0,i+1)})];
  const cards=[
    chartCard('ov-trend','📊 Revenue from operations, Profit & Net profit ratio',amtSpec(c,{type:'bar',labels:M.labels,highlight:i,series:[{name:'Revenue from operations',data:m.revenue},{name:'Profit for the year',data:m.netIncome},{name:'Net profit ratio %',data:r.netMargin,kind:'line',axis:'y2',color:'var(--c3)'}],fmt2:axisPct,tf2:fmtPct}),{span:8}),
    healthCard('ov-health',M,i),
    chartCard('ov-wf',`🌊 Revenue to Net Profit bridge — ${M.labels[i]}`,amtSpec(c,{type:'waterfall',steps:plSteps(m,i),height:300}),{span:6}),
    card('ov-ins','💡 Key Insights',insightsHTML(insightsFor(M,i,'overview')),{span:6}),
    latestResultCard(co),
    chartCard('ov-margins','📐 Margin Trends',{type:'line',labels:M.labels,highlight:i,zero:false,series:[{name:'Gross',data:r.grossMargin},{name:'EBITDA',data:r.ebitdaMargin},{name:'Operating',data:r.opMargin},{name:'Net',data:r.netMargin}],fmt:axisPct,tf:fmtPct},{span:6,sw:true}),
    co.price&&co.price.length>2?chartCard('ov-price','💹 Share Price — last 5 years (monthly)',{type:'area',zero:false,labels:co.price.map(p=>{const d=new Date(p[0]);return d.toLocaleDateString('en-GB',{month:'short',year:'2-digit'})}),series:[{name:'Close',data:co.price.map(p=>p[1])}],fmt:v=>fmtNum(v,co.info?.currency,0),tf:v=>(SYM[co.info?.currency]||'')+fmtNum(v,co.info?.currency,2)},{span:6,sw:true}):null,
  ];
  return heroHTML(co,M,i)+kpiRow(k)+grid('overview',cards)}

function vPL(){const nd=needCo();if(nd)return nd;const{M,i,y,m,r,c,sub:subT}=ctx();
  const k=[['💰','Revenue from operations','revenue'],['🧮','Gross Profit','grossProfit'],['⚙️','EBITDA','ebitda'],['🏭','Operating Profit (EBIT)','ebit'],['🧾','Profit Before Tax','pbt'],['🏆','Profit for the year (PAT)','netIncome']].map(([ic,l,key])=>kpi({icon:ic,label:l,...chgK(M,m,key,i,y)}));
  k.push(kpi({icon:'🪙',label:'EPS',kind:'eps',...chgK(M,m,'eps',i,y)}));
  const rev=m.revenue[i],parts=[['Cost of revenue',m.cogs[i]],['Other operating costs',isNum(m.cogs[i])?sub(sub(rev,m.ebitda[i]),m.cogs[i]):sub(rev,m.ebitda[i])],['Depreciation',absN(m.dep[i])],['Interest',absN(m.interest[i])],['Tax',m.tax[i]],['Net profit',m.netIncome[i]]];
  const known=parts.reduce((a,p)=>a+(isNum(p[1])?p[1]:0),0),resid=isNum(rev)?rev-known:null;if(isNum(resid)&&resid>Math.abs(rev)*0.005)parts.push(['Other / exceptional',resid]);
  const cards=[
    chartCard('pl-rev','📊 Revenue vs Expenses vs Net Profit',amtSpec(c,{type:'bar',labels:M.labels,highlight:i,series:[{name:'Revenue from operations',data:m.revenue},{name:'Total costs',data:m.revenue.map((v,j)=>sub(v,m.netIncome[j]))},{name:'Profit for the year',data:m.netIncome}]}),{span:8,sw:true}),
    chartCard('pl-cost',`🍩 Where revenue goes — ${M.labels[i]}`,{type:'doughnut',items:parts.map(([label,value])=>({label,value})),tf:v=>fmtAmt(v,c),center:{label:'Revenue',value:fmtAmt(rev,c)}},{span:4,note:isNum(resid)&&resid<-Math.abs(rev)*0.005?`➕ Other income of ${fmtAmt(-resid,c)} boosted profit.`:''}),
    chartCard('pl-margins','📐 Margin Trends',{type:'line',labels:M.labels,highlight:i,zero:false,series:[{name:'Gross',data:r.grossMargin},{name:'EBITDA',data:r.ebitdaMargin},{name:'Operating',data:r.opMargin},{name:'Net',data:r.netMargin}],fmt:axisPct,tf:fmtPct},{span:6,sw:true}),
    chartCard('pl-growth','🚀 YoY Growth',{type:'bar',labels:M.labels,highlight:i,series:[{name:'Revenue',data:r.revGrowth},{name:'EBITDA',data:r.ebitdaGrowth},{name:'Net Profit',data:r.niGrowth}],fmt:axisPct,tf:fmtPct},{span:6,sw:true}),
    chartCard('pl-wf',`🌊 Profit bridge — ${M.labels[i]}`,amtSpec(c,{type:'waterfall',steps:plSteps(m,i),height:300}),{span:6}),
    chartCard('pl-eps','🪙 Earnings per Share',{type:'bar',labels:M.labels,highlight:i,series:[{name:'EPS',data:m.eps,color:'var(--c4)'}],fmt:v=>fmtNum(v,c,1),tf:v=>fmtBy('eps',v,c)},{span:6,sw:true}),
    card('pl-ins','📝 Section Analysis — Profit & Loss',insightsHTML(insightsFor(M,i,'pl')),{span:12}),
    s3Card('pl'),stmtCard('income')];
  return vhead('📈 Profit & Loss Analysis',subT)+kpiRow(k)+grid('pl',cards)}

function vBS(){const nd=needCo();if(nd)return nd;const{M,i,y,m,r,c,sub:subT}=ctx();
  const k=[kpi({icon:'🏢',label:'Total Assets',...chgK(M,m,'totalAssets',i,y)}),kpi({icon:'🏛️',label:'Total equity',...chgK(M,m,'equity',i,y)}),kpi({icon:'🏦',label:'Borrowings (incl. leases)',...chgK(M,m,'debt',i,y,-1)}),
    kpi({icon:'💵',label:'Cash & Equivalents',...chgK(M,m,'cash',i,y)}),kpi({icon:'🔄',label:'Working Capital',...chgK(M,m,'workingCapital',i,y)}),kpi({icon:'⚖️',label:'Net Debt',...chgK(M,m,'netDebt',i,y,-1)})];
  const ta=m.totalAssets[i],ps=[['Cash and cash equivalents',m.cash[i]],['Trade receivables',m.receivables[i]],['Inventories',m.inventory[i]],['Property, plant & equipment',m.ppe[i]],['Investments',m.investments[i]]];
  const known=ps.reduce((a,p)=>a+(isNum(p[1])&&p[1]>0?p[1]:0),0);if(isNum(ta)&&ta-known>0)ps.push(['Other assets',ta-known]);
  const otherL=m.totalLiab.map((v,j)=>isNum(v)?v-(isNum(m.debt[j])?m.debt[j]:0):null);
  const cards=[
    chartCard('bs-struct','🏗️ Funding Structure (Equity + Debt + Other liabilities)',amtSpec(c,{type:'bar',stacked:true,labels:M.labels,highlight:i,series:[{name:'Equity',data:m.equity},{name:'Debt',data:m.debt,color:'var(--c5)'},{name:'Other liabilities',data:otherL,color:'var(--c8)'}]}),{span:8}),
    chartCard('bs-mix',`🍩 Asset Mix — ${M.labels[i]}`,{type:'doughnut',items:ps.map(([label,value])=>({label,value})),tf:v=>fmtAmt(v,c),center:{label:'Total assets',value:fmtAmt(ta,c)}},{span:4}),
    chartCard('bs-liq','💧 Liquidity Ratios',{type:'line',labels:M.labels,highlight:i,series:[{name:'Current ratio',data:r.currentRatio},{name:'Quick ratio',data:r.quickRatio},{name:'Cash ratio',data:r.cashRatio}],refs:[{v:1,label:'1.0× benchmark'}],fmt:axisX,tf:v=>v.toFixed(2)+'×'},{span:6,sw:true}),
    chartCard('bs-lev','🏦 Debt vs Equity',amtSpec(c,{type:'bar',labels:M.labels,highlight:i,series:[{name:'Equity',data:m.equity},{name:'Debt',data:m.debt,color:'var(--c5)'},{name:'D/E ratio',data:r.debtEquity,kind:'line',axis:'y2',color:'var(--c3)'}],fmt2:axisX,tf2:v=>v.toFixed(2)+'×'}),{span:6}),
    chartCard('bs-wc','🔄 Working Capital',amtSpec(c,{type:'bar',labels:M.labels,highlight:i,series:[{name:'Current assets',data:m.currentAssets},{name:'Current liabilities',data:m.currentLiab},{name:'Working capital',data:m.workingCapital,kind:'line',color:'var(--c4)'}]}),{span:6}),
    chartCard('bs-days','⏱️ Working-capital Days',{type:'bar',labels:M.labels,highlight:i,series:[{name:'Debtor days',data:r.debtorDays},{name:'Inventory days',data:r.invDays},{name:'Payable days',data:r.payableDays},{name:'Cash cycle',data:r.ccc,kind:'line',color:'var(--c5)'}],fmt:v=>Math.round(v)+'d',tf:v=>Math.round(v)+' days'},{span:6}),
    card('bs-ins','📝 Section Analysis — Balance Sheet',insightsHTML(insightsFor(M,i,'bs'))+(M.freq==='quarterly'?'<div class="note">ℹ️ Indian companies publish balance sheets half-yearly, so some quarters show “—”.</div>':''),{span:12}),
    s3Card('bs'),stmtCard('balance')];
  return vhead('🏦 Balance Sheet Analysis',subT)+kpiRow(k)+grid('bs',cards)}

function vCF(){const nd=needCo();if(nd)return nd;const{M,i,y,m,r,c,sub:subT}=ctx();
  const capAbs=m.capex.map(absN);
  const k=[kpi({icon:'🏭',label:'Net cash from operating activities',...chgK(M,m,'ocf',i,y)}),kpi({icon:'📦',label:'Net cash from investing activities',...chgK(M,m,'icf',i,y)}),kpi({icon:'🏦',label:'Net cash from financing activities',...chgK(M,m,'fincf',i,y)}),
    kpi({icon:'🌊',label:'Free Cash Flow',...chgK(M,m,'fcf',i,y)}),kpi({icon:'🔧',label:'Purchase of PPE (capex)',v:capAbs[i],cur:c,chg:y!=null?growth(capAbs[i],capAbs[y]):null,vs:y!=null?M.labels[y]:'',spark:capAbs.slice(0,i+1)}),
    kpi({icon:'✅',label:'Cash Conversion',kind:'x',v:r.ocfToNI[i],cur:c,chg:y!=null?growth(r.ocfToNI[i],r.ocfToNI[y]):null,vs:y!=null?M.labels[y]:'',spark:r.ocfToNI.slice(0,i+1)})];
  const st=[['Operating',m.ocf[i]],['Investing',m.icf[i]],['Financing',m.fincf[i]]].filter(x=>isNum(x[1])).map(([label,value])=>({label,value}));
  if(st.length)st.push({label:'Net change',value:st.reduce((a,s)=>a+s.value,0),total:true});
  const cards=[
    chartCard('cf-three','💵 Cash Flow by Activity',amtSpec(c,{type:'bar',labels:M.labels,highlight:i,series:[{name:'Operating',data:m.ocf,color:'var(--c4)'},{name:'Investing',data:m.icf,color:'var(--c3)'},{name:'Financing',data:m.fincf,color:'var(--c6)'}]}),{span:8,sw:true}),
    chartCard('cf-wf',`🌊 Cash Bridge — ${M.labels[i]}`,amtSpec(c,{type:'waterfall',steps:st,height:280}),{span:4}),
    chartCard('cf-fcf','🌊 Free Cash Flow & FCF Margin',amtSpec(c,{type:'bar',labels:M.labels,highlight:i,series:[{name:'Free cash flow',data:m.fcf,color:'var(--c2)'},{name:'FCF margin %',data:r.fcfMargin,kind:'line',axis:'y2',color:'var(--c3)'}],fmt2:axisPct,tf2:fmtPct}),{span:6}),
    chartCard('cf-quality','✅ Earnings Quality: Cash vs Profit',amtSpec(c,{type:'bar',labels:M.labels,highlight:i,series:[{name:'Operating cash flow',data:m.ocf,color:'var(--c4)'},{name:'Net profit',data:m.netIncome,color:'var(--c1)'},{name:'OCF ÷ Profit',data:r.ocfToNI,kind:'line',axis:'y2',color:'var(--c3)'}],fmt2:axisX,tf2:v=>v.toFixed(2)+'×'}),{span:6}),
    chartCard('cf-capex','🔧 Capex & Capex Intensity',amtSpec(c,{type:'bar',labels:M.labels,highlight:i,series:[{name:'Capex',data:capAbs,color:'var(--c5)'},{name:'Capex % revenue',data:r.capexToRev,kind:'line',axis:'y2',color:'var(--c3)'}],fmt2:axisPct,tf2:fmtPct}),{span:6}),
    card('cf-ins','📝 Section Analysis — Cash Flow',insightsHTML(insightsFor(M,i,'cf')),{span:6}),
    s3Card('cf'),stmtCard('cashflow')];
  return vhead('💵 Cash Flow Analysis',subT)+kpiRow(k)+grid('cf',cards)}

/* ---------- statement tables (search / sort / key-items / CSV) ---------- */
const STN={income:'Profit & Loss Statement',balance:'Balance Sheet',cashflow:'Cash Flow Statement'};
function stmtCard(st){const t=S.tbl[st];
  return card('tbl-'+st,`📄 Source line items (as reported) — ${STN[st]}, ${S.freq==='annual'?'annual':'quarterly'}`,`<div class="tbl-tools"><div class="search sm"><span>🔍</span><input data-role="tbl-q" data-st="${st}" value="${esc(t.q)}" placeholder="Search line items…"></div>
    <label class="chk"><input type="checkbox" data-role="tbl-key" data-st="${st}" ${t.key?'checked':''}> ⭐ Key items only</label><button class="btn sm" data-act="tbl-csv" data-st="${st}">⬇️ CSV</button><span class="note">Click a column header to sort</span></div>
    <div class="tbl-wrap" id="tblw-${st}">${stmtTable(st)}</div>`,{span:12})}
function stmtRows(st){
  const co=activeCo(),b=co&&co[S.freq]&&co[S.freq][st];if(!b||!b.periods.length)return null;
  const M=getModel(S.active),t=S.tbl[st],sd=M?M.periods[selIndex(M)]:null,ts=b.periods.map(p=>+new Date(p));
  let sel=b.periods.length-1;if(sd){const x=+new Date(sd);let bd=Infinity;ts.forEach((v,j)=>{const d=Math.abs(v-x);if(d<bd&&d<=20*864e5){bd=d;sel=j}})}
  let prev=ts.findIndex(v=>Math.abs((ts[sel]-v)/864e5-365)<=25);if(prev<0)prev=sel-1;
  let rows=Object.entries(b.items).map(([name,vals],ord)=>({name,vals,ord,key:KEYNORMS.includes(norm(name)),chg:prev>=0?growth(vals[sel],vals[prev]):null}));
  if(t.key)rows=rows.filter(r=>r.key);if(t.q){const q=t.q.toLowerCase();rows=rows.filter(r=>r.name.toLowerCase().includes(q))}
  if(t.sort){const{c,d}=t.sort;rows.sort((a,b2)=>{const va=c==='name'?a.name:c==='chg'?a.chg:a.vals[c],vb=c==='name'?b2.name:c==='chg'?b2.chg:b2.vals[c];
    if(c==='name')return d*va.localeCompare(vb);return d*((isNum(va)?va:-Infinity)-(isNum(vb)?vb:-Infinity))})}
  return{b,rows,sel,prev,cur:M?M.cur:'INR',labs:b.periods.map(p=>{const x=pmeta(p,M?M.indian:true);return S.freq==='annual'?x.fyL:x.qL})}}
const rowKind=n=>/\beps\b|per share/i.test(n)?'eps':/\bshares\b|share issued|\bnumber\b/i.test(n)?'cnt':/\brate\b/i.test(n)?'rate':'amt';
function stmtTable(st){const d=stmtRows(st);if(!d)return'<div class="empty">📭 No data published for this statement.</div>';const{b,rows,sel,cur,labs}=d,t=S.tbl[st];
  const ar=c=>t.sort&&t.sort.c===c?(t.sort.d>0?' ▲':' ▼'):'';
  const fmtC=(n,v)=>{const k=rowKind(n);return k==='rate'?(isNum(v)?fmtPct(Math.abs(v)<=1?v*100:v):'—'):fmtBy(k,v,cur)};
  if(!rows.length)return'<div class="empty">🔍 No line items match your search.</div>';
  return`<table class="tbl"><thead><tr><th data-act="tbl-sort" data-st="${st}" data-c="name">Line item${ar('name')}</th>${labs.map((l,j)=>`<th class="num${j===sel?' sel':''}" data-act="tbl-sort" data-st="${st}" data-c="${j}">${l}${ar(j)}<small>${fmtDate(b.periods[j])}</small></th>`).join('')}<th class="num" data-act="tbl-sort" data-st="${st}" data-c="chg">Δ% ${labs[sel]}${ar('chg')}<small>vs prior</small></th></tr></thead>
  <tbody>${rows.map(r=>`<tr class="${r.key?'key':''}"><td>${r.key?'⭐ ':''}${esc(r.name)}</td>${r.vals.map((v,j)=>`<td class="num${j===sel?' sel':''}">${fmtC(r.name,v)}</td>`).join('')}<td class="num ${isNum(r.chg)?(r.chg>=0?'pos-t':'neg-t'):''}">${isNum(r.chg)?(r.chg>=0?'▲ ':'▼ ')+fmtPct(Math.abs(r.chg)):'—'}</td></tr>`).join('')}</tbody></table>`}
/* ---------- Ratio analysis ---------- */
function ratioCardsHTML(){const c=ctx();if(!c||!c.M)return'';const{M,i,y,c:cur}=c,q=S.ratioQ.toLowerCase();
  return GROUPS.filter(([g])=>S.ratioGroup==='All'||S.ratioGroup===g).map(([g,ic])=>{
    const list=RATIOS.filter(d=>d.g===g&&(!q||(d.n+' '+d.f).toLowerCase().includes(q)));if(!list.length)return'';
    return`<div class="rgroup"><h3>${ic} ${g}</h3><div class="rcards">${list.map((d,k)=>{const v=M.r[d.k][i],pv=y!=null?M.r[d.k][y]:null,s=status(d,v);
      const arrow=isNum(v)&&isNum(pv)?(v>pv?'▲':v<pv?'▼':'▬'):'';const better=d.dir&&isNum(v)&&isNum(pv)&&v!==pv?((v>pv)===(d.dir>0)?'pos-t':'neg-t'):'';
      return`<div class="rcard${S.ratioSel===d.k?' active':''}" data-act="ratio-pick" data-k="${d.k}" style="animation-delay:${k*30}ms" data-tip="${esc(`<b>${d.n}</b><br>${d.f}<br><i>${d.tip}</i><br>Benchmark: ${benchText(d)}`)}">
        <div class="rc-top"><span>${d.n}</span>${stChip(s)}</div><div class="rc-val">${fmtBy(d.kind,v,cur)}</div>
        <div class="rc-foot">${isNum(pv)?`<span class="${better}">${arrow}</span> from ${fmtBy(d.kind,pv,cur)} in ${M.labels[y]}`:'&nbsp;'}</div>${spark(M.r[d.k].slice(0,i+1),s==='weak'?'var(--neg)':s==='good'?'var(--pos)':'var(--accent)')}<div class="rc-formula">🧮 ${d.f}</div></div>`}).join('')}</div></div>`}).join('')||'<div class="empty">🔍 No ratios match.</div>'}
function ratioTrendSpec(M,i){const d=RMAP[S.ratioSel]||RMAP.roe,f=d.kind==='pct'?fmtPct:d.kind==='x'?v=>v.toFixed(2)+'×':d.kind==='days'?v=>Math.round(v)+' days':v=>fmtAmt(v,M.cur);
  const refs=d.band?[{v:d.band[d.dir>0?1:0],label:'strong'},{v:d.band[d.dir>0?0:1],label:'weak'}]:[];
  return{type:'line',labels:M.labels,highlight:i,zero:false,series:[{name:d.n,data:M.r[d.k]}],refs,fmt:d.kind==='amt'?axisAmt(M.cur):d.kind==='pct'?axisPct:d.kind==='x'?axisX:v=>Math.round(v)+'',tf:f}}
function groupScores(M,i){return GROUPS.map(([g])=>{const sc={good:100,ok:60,weak:20};const v=RATIOS.filter(d=>d.g===g).map(d=>status(d,M.r[d.k][i])).filter(Boolean).map(s=>sc[s]);return v.length?Math.round(v.reduce((a,b)=>a+b)/v.length):null})}
function vRatios(){const nd=needCo();if(nd)return nd;const{co,M,i,y,r,c,sub:subT}=ctx(),inf=co.info||{};
  const dpc=(lab,k,kind,o='')=>`<div class="dp ${o}"><span>${lab}</span><b>${fmtBy(kind,r[k][i],c)}</b><small>${y!=null?`${M.labels[y]}: ${fmtBy(kind,r[k][y],c)}`:''}</small></div>`;
  const dupont=card('r-dupont','🧩 DuPont Analysis — what drives ROE?',`<div class="dupont">${dpc('🎯 ROE','roe','pct','main')}<span class="op">=</span>${dpc('📏 Net margin','netMargin','pct')}<span class="op">×</span>${dpc('🔁 Asset turnover','assetTurnover','x')}<span class="op">×</span>${dpc('🏗️ Equity multiplier','equityMultiplier','x')}</div>
    <div class="note">Profitability × Efficiency × Leverage = Return on Equity${M.A>1?' · quarterly figures annualised (×4)':''}. ${insightsFor(M,i,'ratios').filter(x=>x.ic==='🧩').map(x=>x.x).join('')}</div>`,{span:8});
  const top=grid('ratios-top',[healthCard('r-health',M,i),dupont]);
  const filt=`<div class="fchips">${['All',...GROUPS.map(g=>g[0])].map(g=>`<span class="chip btnchip${S.ratioGroup===g?' acc':''}" data-act="rgroup" data-g="${g}">${g==='All'?'🗂️':GROUPS.find(x=>x[0]===g)[1]} ${g}</span>`).join('')}
    <div class="search sm" style="margin-left:auto"><span>🔍</span><input data-role="ratio-q" value="${esc(S.ratioQ)}" placeholder="Search ratios…"></div></div>`;
  const gs=groupScores(M,i),gp=y!=null?groupScores(M,y):null;
  const dyv=isNum(inf.dividendYield)?(inf.dividendYield<0.2?inf.dividendYield*100:inf.dividendYield):null,pc2=inf.currency||c;
  const val=[['💹 Share price',isNum(inf.currentPrice??inf.regularMarketPrice)?(SYM[pc2]||'')+fmtNum(inf.currentPrice??inf.regularMarketPrice,pc2,2):null],['🏢 Market cap',isNum(inf.marketCap)?fmtAmt(inf.marketCap,pc2):null],['🏷️ P/E (TTM)',isNum(inf.trailingPE)?inf.trailingPE.toFixed(1)+'×':null],['🔮 Forward P/E',isNum(inf.forwardPE)?inf.forwardPE.toFixed(1)+'×':null],['📘 Price / Book',isNum(inf.priceToBook)?inf.priceToBook.toFixed(2)+'×':null],['🧮 EV / EBITDA',isNum(inf.enterpriseToEbitda)?inf.enterpriseToEbitda.toFixed(1)+'×':null],['📦 EV / Revenue',isNum(inf.enterpriseToRevenue)?inf.enterpriseToRevenue.toFixed(2)+'×':null],['🎁 Dividend yield',isNum(dyv)?dyv.toFixed(2)+'%':null],['📉 Beta',isNum(inf.beta)?inf.beta.toFixed(2):null]].filter(x=>x[1]);
  const opts=RATIOS.map(d=>`<option value="${d.k}" ${d.k===S.ratioSel?'selected':''}>${d.n}</option>`).join('');
  const cards=[
    chartCard('r-trend','📈 Ratio Trend',ratioTrendSpec(M,i),{span:8,sw:true,pre:`<select data-role="ratio-sel" style="margin-bottom:6px">${opts}</select>`,note:'Tip: click any ratio card above to chart it here. Dashed lines show strong/weak benchmarks.'}),
    chartCard('r-radar','🕸️ Ratio Profile (score by area)',{type:'radar',labels:GROUPS.map(g=>g[1]+' '+g[0]),series:[{name:M.labels[i],data:gs,raw:gs.map(v=>v==null?'n/a':v+'/100')},...(gp?[{name:M.labels[y],data:gp,raw:gp.map(v=>v==null?'n/a':v+'/100'),color:'var(--c3)'}]:[])],height:300},{span:4}),
    val.length?card('r-val','🏷️ Valuation (current market)',`<div class="vtiles">${val.map(([a,b])=>`<div class="vt"><span>${a}</span><b>${b}</b></div>`).join('')}</div>`,{span:12}):null,
    card('r-s3','📜 Schedule III (Division II) ratios — Additional Regulatory Information',`<div class="tbl-wrap s3-wrap">${s3RatiosHTML(co)}</div>`,{span:12}),
    card('r-table','📋 All Ratios — every period',`<div class="tbl-tools"><button class="btn sm" data-act="ratio-csv">⬇️ Download ratios CSV</button><span class="note">🟢 strong · 🟡 fair · 🔴 weak (generic benchmarks — compare with industry peers)</span></div><div class="tbl-wrap">${ratioTable(M,i)}</div>`,{span:12})];
  return vhead('🧮 Ratio Analysis',subT)+top+filt+`<div id="ratio-cards">${ratioCardsHTML()}</div>`+grid('ratios',cards)}
function ratioTable(M,i){const ico={good:'🟢',ok:'🟡',weak:'🔴'};
  return`<table class="tbl"><thead><tr><th>Ratio</th>${M.labels.map((l,j)=>`<th class="num${j===i?' sel':''}">${l}</th>`).join('')}<th>Benchmark</th></tr></thead><tbody>${GROUPS.map(([g,gi])=>`<tr class="grp"><td colspan="${M.labels.length+2}">${gi} ${g}</td></tr>`+RATIOS.filter(d=>d.g===g).map(d=>`<tr><td title="${esc(d.f)}">${d.n}</td>${M.r[d.k].map((v,j)=>{const s=status(d,v);return`<td class="num${j===i?' sel':''}">${s?ico[s]+' ':''}${fmtBy(d.kind,v,M.cur)}</td>`}).join('')}<td class="note">${benchText(d)}</td></tr>`).join('')).join('')}</tbody></table>`}

/* ---------- Peer comparison ---------- */
const CMP=[['💰 Revenue','amt','m','revenue',1],['⚙️ EBITDA','amt','m','ebitda',1],['🏆 Net Profit','amt','m','netIncome',1],['🏢 Total Assets','amt','m','totalAssets',0],['🏦 Market Cap','mcap','i','marketCap',1],
  ['🚀 Revenue Growth','pct','r','revGrowth',1],['💹 Profit Growth','pct','r','niGrowth',1],['🧮 Gross Margin','pct','r','grossMargin',1],['⚙️ EBITDA Margin','pct','r','ebitdaMargin',1],['📏 Net Margin','pct','r','netMargin',1],
  ['🎯 ROE','pct','r','roe',1],['🏗️ ROCE','pct','r','roce',1],['🏢 ROA','pct','r','roa',1],['💧 Current Ratio','x','r','currentRatio',1],['⚖️ Debt / Equity','x','r','debtEquity',-1],['🛡️ Interest Coverage','x','r','interestCover',1],
  ['🔁 Asset Turnover','x','r','assetTurnover',1],['⏱️ Debtor Days','days','r','debtorDays',-1],['✅ OCF / Net Profit','x','r','ocfToNI',1],['🏷️ P/E','x','i','trailingPE',-1],['📘 P/B','x','i','priceToBook',-1],['🧮 EV/EBITDA','x','i','enterpriseToEbitda',-1]];
function fxRate(from,to){if(from===to)return 1;const k=from+to;if(k in S.fx)return S.fx[k];
  if(SERVER&&S.online&&!S.fx['_p'+k]){S.fx['_p'+k]=1;fetch(`/api/fx?from=${from}&to=${to}`).then(r=>r.json()).then(d=>{if(isNum(d.rate)){S.fx[k]=d.rate;if(S.tab==='compare')render()}}).catch(()=>{})}
  return null}
function vCompare(){
  const syms=Object.keys(S.companies);
  const head=vhead('⚖️ Peer Comparison',`Compare companies side-by-side on their latest ${S.freq} results`,`<div class="search sm" style="max-width:340px;min-width:240px"><span>➕</span><input id="peerQ" autocomplete="off" placeholder="Add a peer — e.g. Wipro, HCL Tech"><div class="suggest" id="peerSuggest"></div></div>`);
  const chips=`<div class="fchips">${syms.map(s=>`<span class="chip btnchip${S.cmpOff.has(s)?' off':' acc'}" data-act="cmp-toggle" data-s="${esc(s)}" title="Click to include / exclude">${S.cmpOff.has(s)?'⬜':'✅'} ${esc(shortName(S.companies[s].name))}</span>`).join('')}</div>`;
  const inc=syms.filter(s=>!S.cmpOff.has(s)&&getModel(s));
  if(inc.length<2)return head+chips+`<div class="card-lite empty" style="padding:40px">⚖️ Add at least <b>two</b> companies to compare.<br><br><div class="wl-quick">${QUICK.filter(([,s])=>!S.companies[s]).slice(0,8).map(([n,s])=>`<span class="chip btnchip" data-act="add-peer" data-q="${s}">➕ ${esc(n)}</span>`).join('')}</div></div>`;
  const baseCur=(getModel(S.active&&inc.includes(S.active)?S.active:inc[0])||{}).cur||'INR';let missingFx=[];
  const P=inc.map((s,k)=>{const M=getModel(s),i=M.periods.length-1,fx=fxRate(M.cur,baseCur),pfx=fxRate((M.co.info||{}).currency||M.cur,baseCur);if(fx==null||pfx==null)missingFx.push(M.cur);
    return{s,M,i,fx,pfx,name:shortName(M.co.name),color:Charts.col(k)}});
  const val=(p,[,kind,src,key])=>{if(src==='m'){const v=p.M.m[key][p.i];return isNum(v)&&p.fx!=null?v*p.fx:null}if(src==='r')return p.M.r[key][p.i];const v=(p.M.co.info||{})[key];if(kind==='mcap')return isNum(v)&&p.pfx!=null?v*p.pfx:null;return isNum(v)&&v>0?v:null};
  const tbl=`<table class="tbl"><thead><tr><th>Metric</th>${P.map(p=>`<th class="num">${esc(p.name)}<small>${p.M.labels[p.i]} · ${fmtDate(p.M.periods[p.i])}</small></th>`).join('')}</tr></thead><tbody>${CMP.map(row=>{const vs=P.map(p=>val(p,row)),ok=vs.filter(isNum);
    const best=row[4]&&ok.length>1?(row[4]>0?Math.max(...ok):Math.min(...ok)):null;
    return`<tr><td>${row[0]}</td>${vs.map(v=>`<td class="num${v===best?' best':''}">${v===best?'🏆 ':''}${fmtBy(row[1]==='mcap'?'amt':row[1],v,baseCur)}</td>`).join('')}</tr>`}).join('')}</tbody></table>`;
  const it=(k,src='m')=>P.map(p=>({label:p.name,value:val(p,CMP.find(r=>r[3]===k&&r[2]===src)),color:p.color}));
  const grp=(keys)=>({type:'bar',labels:P.map(p=>p.name),series:keys.map(([n,k])=>({name:n,data:P.map(p=>p.M.r[k][p.i])}))});
  const RAX=[['Net margin','netMargin',1],['ROE','roe',1],['ROCE','roce',1],['Growth','revGrowth',1],['Liquidity','currentRatio',1],['Low debt','debtEquity',-1],['Asset turnover','assetTurnover',1],['Cash conversion','ocfToNI',1]];
  const radarS=P.map(p=>{const data=RAX.map(([,k,d])=>{const vals=P.map(q=>q.M.r[k][q.i]).filter(isNum),v=p.M.r[k][p.i];if(!isNum(v)||!vals.length)return null;const lo=Math.min(...vals),hi=Math.max(...vals);if(hi===lo)return 60;const t=(v-lo)/(hi-lo);return Math.round(20+80*(d>0?t:1-t))});
    return{name:p.name,data,color:p.color,raw:RAX.map(([,k])=>{const d=RMAP[k];return fmtBy(d.kind,p.M.r[k][p.i],baseCur)})}});
  const labSet=new Map();P.forEach(p=>p.M.periods.forEach((d,j)=>labSet.set(p.M.labels[j],p.M.metas[j].fy*10+(S.freq==='quarterly'?p.M.metas[j].q:0))));
  const labs=[...labSet].sort((a,b)=>a[1]-b[1]).map(x=>x[0]).slice(-10);
  const trend=k=>({type:'line',labels:labs,zero:false,series:P.map(p=>({name:p.name,color:p.color,data:labs.map(l=>{const j=p.M.labels.lastIndexOf(l);const v=j>=0?p.M.m[k][j]:null;return isNum(v)&&p.fx!=null?v*p.fx:null})})),fmt:axisAmt(baseCur),tf:v=>fmtAmt(v,baseCur)});
  const lead=(k,dir,label)=>{const c=P.map(p=>[p,p.M.r[k][p.i]]).filter(x=>isNum(x[1]));if(c.length<2)return null;c.sort((a,b)=>dir*(b[1]-a[1]));const d=RMAP[k];return{t:'pos',ic:'🏆',x:`<b>${esc(c[0][0].name)}</b> leads on ${label} (${fmtBy(d.kind,c[0][1],baseCur)}), vs ${esc(lastOf(c)[0].name)} at ${fmtBy(d.kind,lastOf(c)[1],baseCur)}.`}};
  const ins=[lead('netMargin',1,'profitability — net margin'),lead('roe',1,'return on equity'),lead('revGrowth',1,'growth'),lead('debtEquity',-1,'balance-sheet strength (lowest D/E)'),lead('ocfToNI',1,'cash conversion')].filter(Boolean);
  const fxNote=[...new Set(P.filter(p=>p.M.cur!==baseCur&&p.fx!=null).map(p=>`1 ${p.M.cur} = ${fmtNum(p.fx,baseCur,2)} ${baseCur}`))].join(' · ');
  const cards=[
    card('c-table','📋 Comparison Table',`${fxNote?`<div class="note" style="margin:0 0 8px">💱 Amounts converted to ${baseCur} at ${fxNote}</div>`:''}${missingFx.length?`<div class="note" style="margin:0 0 8px">⚠️ Exchange rate for ${[...new Set(missingFx)].join(', ')} unavailable offline — amounts for those companies are hidden, ratios still compare.</div>`:''}<div class="tbl-wrap">${tbl}</div>`,{span:12}),
    chartCard('c-rev','💰 Revenue',{type:'hbar',multi:true,items:it('revenue'),fmt:axisAmt(baseCur),tf:v=>fmtAmt(v,baseCur)},{span:6}),
    chartCard('c-np','🏆 Net Profit',{type:'hbar',multi:true,items:it('netIncome'),fmt:axisAmt(baseCur),tf:v=>fmtAmt(v,baseCur)},{span:6}),
    chartCard('c-margin','📐 Margins',Object.assign(grp([['Gross','grossMargin'],['EBITDA','ebitdaMargin'],['Net','netMargin']]),{fmt:axisPct,tf:fmtPct}),{span:6,sw:true}),
    chartCard('c-returns','🎯 Returns',Object.assign(grp([['ROE','roe'],['ROCE','roce'],['ROA','roa']]),{fmt:axisPct,tf:fmtPct}),{span:6,sw:true}),
    chartCard('c-solv','🛡️ Liquidity, Leverage & Efficiency',Object.assign(grp([['Current ratio','currentRatio'],['Debt/Equity','debtEquity'],['Asset turnover','assetTurnover']]),{fmt:axisX,tf:v=>v.toFixed(2)+'×'}),{span:6,sw:true}),
    chartCard('c-radar','🕸️ Relative Strength Radar',{type:'radar',labels:RAX.map(a=>a[0]),series:radarS,height:320},{span:6,note:'Scored 20–100 relative to the peer group (100 = best in group).'}),
    chartCard('c-trend','📈 Revenue Trend',trend('revenue'),{span:12,sw:true}),
    card('c-ins','💡 Comparison Insights',insightsHTML(ins),{span:12})];
  return head+chips+grid('compare',cards)}

/* ---------- Smart upload: parsing & auto-detection ---------- */
const MON={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
const iso=(y,m,d)=>{const x=new Date(Date.UTC(y,m-1,d));return isNaN(x)||x.getUTCMonth()!==m-1?null:x.toISOString().slice(0,10)};
const monthEnd=(y,m)=>new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
const yr=s=>{const n=+s;return s.length===2?2000+n:n};
function parsePeriod(v,allowYear=true){const s=String(v??'').trim();if(!s||s.length>30)return null;let m;
  if(m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))return iso(+m[1],+m[2],+m[3]);
  if(m=s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/))return iso(+m[1],+m[2],+m[3]);
  if(m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/)){let d=+m[1],mo=+m[2];if(mo>12&&d<=12)[d,mo]=[mo,d];return iso(yr(m[3]),mo,d)}
  if(m=s.match(/^(\d{1,2})[\s\-]([A-Za-z]{3})[a-z]*[\s\-,]+(\d{2}|\d{4})$/)){const mo=MON[m[2].toLowerCase()];return mo?iso(yr(m[3]),mo,+m[1]):null}
  if(m=s.match(/^([A-Za-z]{3})[a-z]*[\s\-',.]*(\d{2}|\d{4})$/)){const mo=MON[m[1].toLowerCase()];return mo?monthEnd(yr(m[2]),mo):null}
  if(m=s.match(/^Q([1-4])\s*[- ]?\s*FY\s*'?(\d{2}|\d{4})$/i)){const fy=yr(m[2]),q=+m[1];return[null,monthEnd(fy-1,6),monthEnd(fy-1,9),monthEnd(fy-1,12),monthEnd(fy,3)][q]}
  if(m=s.match(/^FY\s*'?(\d{2}|\d{4})$/i))return monthEnd(yr(m[1]),3);
  if(m=s.match(/^(\d{4})\s*[-–\/]\s*(\d{2}|\d{4})$/)){const a=+m[1],b=yr(m[2].length===2?String(a).slice(0,2)+m[2]:m[2]);if(b===a+1)return monthEnd(b,3);if(+m[2]>=1&&+m[2]<=12&&m[2].length<=2)return monthEnd(a,+m[2]);return null}
  if(allowYear&&(m=s.match(/^(\d{4})$/))&&+m[1]>1950&&+m[1]<2100)return monthEnd(+m[1],3);
  return null}
function parseNum(v){if(typeof v==='number')return isFinite(v)?v:null;let s=String(v??'').trim();if(!s||s==='-'||s==='—')return null;let neg=false;
  if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1)}s=s.replace(/[₹$€£,\s%]|Rs\.?|INR/gi,'');if(s.endsWith('-')){neg=true;s=s.slice(0,-1)}
  if(!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s))return null;const n=parseFloat(s);return isFinite(n)?(neg?-n:n):null}
function parseCSV(text,delim){const rows=[];let row=[],f='',q=false;for(let i=0;i<text.length;i++){const c=text[i];
  if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
  else if(c==='"')q=true;else if(c===delim){row.push(f);f=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(f);rows.push(row);row=[];f=''}else f+=c}
  if(f!==''||row.length){row.push(f);rows.push(row)}return rows}
function detectDelim(t){const l=t.split(/\r?\n/).slice(0,5).join('\n');return[',',';','\t','|'].map(d=>[d,l.split(d).length]).sort((a,b)=>b[1]-a[1])[0][0]}
const isKeyName=s=>{const t=norm(s);return t.length>1&&KEYNORMS.some(k=>t===k||(k.length>=5&&t.startsWith(k)))};
const CAP_NUM=/^\s*(?:\(?[ivxlcdm]{1,5}\)|\(?[a-z]{1,2}\)|\(?[A-Z]\)|[IVXLC]{1,6}\.|\d{1,2}[.)])\s*/i;
function cleanCaption(s){let x=String(s??'').trim(),p;do{p=x;x=x.replace(CAP_NUM,'')}while(x!==p&&x);return x.replace(/\s*\*+$/,'').trim()}
const AMBIG=new Set(['investments','tradereceivables','loans','others','borrowings','leaseliabilities','tradepayables','otherfinancialliabilities','provisions','otherfinancialassets']);
function detectFinancial(rows){
  for(let h=0;h<Math.min(rows.length,12);h++){const pcols=[];(rows[h]||[]).forEach((c,j)=>{if(j>0){const p=parsePeriod(c);if(p)pcols.push([j,p])}});
    if(pcols.length>=2&&new Set(pcols.map(x=>x[1])).size===pcols.length){const items={};let hits=0;
      let sect='';for(let r=h+1;r<rows.length;r++){let name=cleanCaption(rows[r][0]);if(!name)continue;const vals=pcols.map(([j])=>parseNum(rows[r][j]));if(!vals.some(isNum)){if(/non[\s-]*current/i.test(name))sect='Non Current ';else if(/current/i.test(name))sect='Current ';else if(/equity|income|expense|cash flow/i.test(name))sect='';continue}if(sect&&AMBIG.has(norm(name)))name=sect+name;if(!(name in items)){items[name]=vals;if(isKeyName(name))hits++}}
      if(hits>=3)return{periods:pcols.map(x=>x[1]),items}}}
  for(let h=0;h<Math.min(rows.length,12);h++){const hdr=rows[h]||[],cols=[];hdr.forEach((c,j)=>{if(j>0&&String(c).trim())cols.push(j)});if(cols.filter(j=>isKeyName(hdr[j])).length<3)continue;
    const prs=[];for(let r=h+1;r<rows.length;r++){const p=parsePeriod(rows[r][0]);if(p)prs.push([r,p])}
    if(prs.length>=2&&new Set(prs.map(x=>x[1])).size===prs.length){const items={};cols.forEach(j=>{items[String(hdr[j]).trim()]=prs.map(([r])=>parseNum(rows[r][j]))});return{periods:prs.map(x=>x[1]),items}}}
  return null}
function importFinancial(name,fins){
  const periods=[...new Set(fins.flatMap(f=>f.periods))].sort(),items={},mulU=parseFloat(S.upUnit)||1;
  fins.forEach(f=>Object.entries(f.items).forEach(([k,v])=>{if(k in items)return;const noScale=/\beps\b|per share|%|\bratios?\b|\bdays\b|\bno\.? of\b|number of|\bshares\b/i.test(k);items[k]=periods.map(p=>{const j=f.periods.indexOf(p);const x=j>=0?v[j]:null;return isNum(x)?(noScale?x:x*mulU):null})}));
  const gaps=periods.slice(1).map((p,k)=>(new Date(p)-new Date(periods[k]))/864e5).sort((a,b)=>a-b),freq=gaps.length&&gaps[Math.floor(gaps.length/2)]<120?'quarterly':'annual';
  const b={periods,items,fuzzy:true},empty={periods:[],items:{}},blk={income:b,balance:b,cashflow:b},none={income:empty,balance:empty,cashflow:empty};
  const co={symbol:'FILE-'+name.replace(/[^\w]+/g,'_').slice(0,40),name,source:'Uploaded file',fetchedAt:new Date().toISOString(),info:{currency:S.upCur,financialCurrency:S.upCur},annual:freq==='annual'?blk:none,quarterly:freq==='quarterly'?blk:none,price:[]};
  S.freq=freq;S.tab='overview';addCompany(co,true);
  toast(`🤖 Detected a financial statement: ${Object.keys(items).length} line items × ${periods.length} ${freq} periods. Full analysis ready!`,'ok',5000)}
function profileCol(name,j,body){
  const vals=body.map(r=>r[j]).filter(v=>v!==''),n=vals.length||1,hn=norm(name),nums=vals.map(parseNum).filter(isNum),dOk=vals.filter(v=>parsePeriod(v,false)).length,distinct=new Set(vals).size;
  let type;
  if(dOk/n>=0.8&&!(nums.length/n>=0.8&&!/date|month|period|day|time/.test(hn)))type='date';
  else if(nums.length/n>=0.8){if(/year|^yr|^fy/.test(hn)&&nums.every(v=>Number.isInteger(v)&&v>1900&&v<2100))type='year';
    else if(/(^id$|id$|code|phone|mobile|pincode|zip|srno|slno|serial|^sno$|^no$)/.test(hn))type='id';else type='num'}
  else type=distinct<=Math.max(12,Math.min(60,n*0.6))?'cat':'text';
  const c={name,i:j,type,distinct,blank:body.length-vals.length};
  if(type==='num')c.agg=/revenue|sales|amount|amt|profit|cost|qty|quantity|units|count|value|income|expense|spend|total|volume|orders|turnover|gst|tax/.test(hn)&&!/rate|ratio|pct|percent|price|avg|average|margin|score|age|rating|discount|%/.test(name.toLowerCase())?'sum':'avg';
  return c}
function buildDataset(name,rows){
  rows=rows.filter(r=>r.some(c=>String(c??'').trim()!==''));if(rows.length<2)return null;
  const width=Math.max(...rows.slice(0,50).map(r=>r.length));let h=rows.findIndex(r=>r.filter(c=>String(c??'').trim()).length>=Math.max(2,width*0.5));if(h<0)h=0;
  const seen={},header=Array.from({length:width},(_,j)=>{let s=String(rows[h][j]??'').trim()||`Column ${j+1}`;if(seen[s])s+=' ('+(++seen[s])+')';else seen[s]=1;return s});
  const body=rows.slice(h+1).map(r=>Array.from({length:width},(_,j)=>r[j]==null?'':String(r[j]).trim()));
  const cols=header.map((n,j)=>profileCol(n,j,body));
  const recs=body.map(r=>cols.map(c=>c.type==='num'?parseNum(r[c.i]):c.type==='date'?parsePeriod(r[c.i],false):c.type==='year'?(parseNum(r[c.i])!=null?Math.round(parseNum(r[c.i]))+'-01-01':null):r[c.i]));
  return{name,cols,recs,filters:{},q:'',sort:null,page:0}}
async function handleFile(file){
  const ext=file.name.split('.').pop().toLowerCase(),base=file.name.replace(/\.[^.]+$/,'');toast(`📂 Reading ${file.name}…`,'info',1500);
  try{
    if(ext==='json'){const j=JSON.parse(await file.text());
      if(j&&j.annual&&j.quarterly){addCompany(j,true);S.tab='overview';render();return}
      if(Array.isArray(j)&&j.length&&typeof j[0]==='object'){const cols=[...new Set(j.flatMap(o=>Object.keys(o)))];return ingest(base,[cols,...j.map(o=>cols.map(c=>o[c]??''))])}
      throw new Error('Unrecognised JSON — expected an array of records')}
    if(ext==='xlsx'||ext==='xls'||ext==='xlsm'){
      const XL=await loadScript('/vendor/xlsx.full.min.js','XLSX'),wb=XL.read(await file.arrayBuffer(),{type:'array',cellDates:true});
      const sheets=wb.SheetNames.map(n=>({s:{sheet:n},rows:XL.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:false,defval:'',dateNF:'yyyy-mm-dd',blankrows:false})})).filter(x=>x.rows.length);const fins=sheets.map(x=>detectFinancial(x.rows)).filter(Boolean);
      if(fins.length)return importFinancial(base,fins);
      const big=sheets.sort((a,b)=>b.rows.length-a.rows.length)[0];if(!big)throw new Error('The workbook is empty');return ingest(base+' · '+big.s.sheet,big.rows)}
    const text=await file.text();ingest(base,parseCSV(text,ext==='tsv'?'\t':detectDelim(text)))
  }catch(e){toast('❌ '+e.message,'err',6000)}}
function ingest(name,rows){const fin=detectFinancial(rows);if(fin)return importFinancial(name,[fin]);
  const ds=buildDataset(name,rows);if(!ds)return toast('❌ No table found in the file','err');S.ds=ds;S.tab='smart';render();
  toast(`🤖 Understood ${ds.recs.length.toLocaleString()} rows × ${ds.cols.length} columns — dashboard auto-generated`,'ok',4000)}

/* ---------- Smart upload: generic auto-dashboard ---------- */
function dsFiltered(ds){const q=ds.q.toLowerCase();return ds.recs.filter(r=>Object.entries(ds.filters).every(([j,v])=>v===''||String(r[j])===v)&&(!q||r.some(c=>c!=null&&String(c).toLowerCase().includes(q))))}
function aggr(vals,agg){const v=vals.filter(isNum);if(!v.length)return null;const s=v.reduce((a,b)=>a+b,0);return agg==='sum'?s:s/v.length}
function groupAgg(recs,keyFn,j,agg){const m=new Map();recs.forEach(r=>{const k=keyFn(r);if(k==null||k==='')return;if(!m.has(k))m.set(k,[]);m.get(k).push(r[j])});return[...m].map(([k,v])=>({k,v:aggr(v,agg),c:v.length}))}
function corr(a,b){const p=a.map((x,i)=>[x,b[i]]).filter(([x,y])=>isNum(x)&&isNum(y));const n=p.length;if(n<5)return null;const mx=p.reduce((s,q)=>s+q[0],0)/n,my=p.reduce((s,q)=>s+q[1],0)/n;let sxy=0,sx=0,sy=0;p.forEach(([x,y])=>{sxy+=(x-mx)*(y-my);sx+=(x-mx)**2;sy+=(y-my)**2});return sx&&sy?sxy/Math.sqrt(sx*sy):null}
function vSmart(){
  const panel=`<div class="card-lite upload"><label class="dropzone" id="dropzone"><input type="file" id="fileIn" accept=".csv,.txt,.tsv,.json,.xlsx,.xls,.xlsm" hidden>
    <div class="dz-ico">📤</div><div><b>Drop a CSV / Excel / JSON file here</b> or click to browse<br><small>🤖 Financial statements (e.g. a Screener.in export or your own P&amp;L / Balance Sheet) are detected automatically and get the full company analysis. Any other table gets an automatic dashboard with KPIs, charts, filters and insights.</small></div></label>
    <div class="upload-opts"><label>💱 Currency <select data-role="up-cur">${['INR','USD','EUR','GBP'].map(c=>`<option ${S.upCur===c?'selected':''}>${c}</option>`).join('')}</select></label>
    <label>🔢 Amounts in the file are in <select data-role="up-unit">${[['1e7','Crore'],['1e5','Lakh'],['1e6','Million'],['1e3','Thousand'],['1','Absolute']].map(([v,l])=>`<option value="${v}" ${S.upUnit===v?'selected':''}>${l}</option>`).join('')}</select></label>
    <span class="spacer"></span><button class="btn sm" data-act="ds-sample">🧪 Try sample sales data</button><button class="btn sm" data-act="fin-template">⬇️ Financial statement template</button>${S.ds?'<button class="btn sm" data-act="ds-clear">🧹 Clear</button>':''}</div></div>`;
  if(!S.ds)return vhead('📤 Smart Upload','Bring your own data — no setup, no mapping')+panel;
  const ds=S.ds,fcols=ds.cols.filter(c=>c.type==='cat'&&c.distinct>=2&&c.distinct<=60).slice(0,5);
  const filters=`<div class="fchips">🎛️ ${fcols.map(c=>`<label class="fgroup">${esc(c.name)} <select data-role="ds-filter" data-j="${c.i}"><option value="">All</option>${[...new Set(ds.recs.map(r=>r[c.i]).filter(v=>v!==''))].sort().map(v=>`<option ${ds.filters[c.i]===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`).join('')}
    <div class="search sm"><span>🔍</span><input data-role="ds-q" value="${esc(ds.q)}" placeholder="Search all columns…"></div><button class="btn sm ghost" data-act="ds-reset">↺ Reset filters</button></div>`;
  return vhead(`📤 ${esc(ds.name)}`,`Auto-generated dashboard · ${ds.cols.map(c=>`${{num:'🔢',date:'📅',year:'📅',cat:'🏷️',text:'📝',id:'🆔'}[c.type]} ${esc(c.name)}`).join(' · ')}`)+panel+filters+`<div id="ds-out">${dsOut()}</div>`}
function dsOut(){const ds=S.ds,recs=dsFiltered(ds),cols=ds.cols;
  const nums=cols.filter(c=>c.type==='num').sort((a,b)=>(b.agg==='sum')-(a.agg==='sum')),cats=cols.filter(c=>c.type==='cat'&&c.distinct>=2),dates=cols.filter(c=>c.type==='date'||c.type==='year');
  const prim=nums.find(c=>/revenue|sales|amount|profit|value|total|income/.test(norm(c.name)))||nums[0];
  const ks=[kpi({icon:'📋',label:'Records',v:recs.length,kind:'cnt',cur:'',chg:null})];
  [prim,...nums.filter(c=>c!==prim)].filter(Boolean).slice(0,5).forEach(c=>{const vs=recs.map(r=>r[c.i]).filter(isNum);ks.push(kpi({icon:c.agg==='sum'?'∑':'⌀',label:(c.agg==='sum'?'Total ':'Average ')+c.name,v:aggr(vs,c.agg),kind:'cnt',cur:''}))});
  const cards=[],ins=[],P=(t,ic,x)=>ins.push({t,ic,x});
  P('neu','📦',`${recs.length.toLocaleString()} of ${ds.recs.length.toLocaleString()} records shown across ${cols.length} columns (${nums.length} numeric, ${cats.length} categorical, ${dates.length} date).`);
  if(prim&&dates[0]){const dc=dates[0],ds2=recs.map(r=>r[dc.i]).filter(Boolean).sort(),span=ds2.length?(new Date(lastOf(ds2))-new Date(ds2[0]))/864e5:0;
    const gran=dc.type==='year'||span>1100?'y':span>62?'m':'d',key=r=>{const d=r[dc.i];return d?(gran==='y'?d.slice(0,4):gran==='m'?d.slice(0,7):d):null};
    const second=nums.find(c=>c!==prim&&c.agg==='sum');const g=groupAgg(recs,key,prim.i,prim.agg).sort((a,b)=>a.k<b.k?-1:1),g2=second?new Map(groupAgg(recs,key,second.i,second.agg).map(x=>[x.k,x.v])):null;
    const lab=k=>gran==='m'?new Date(k+'-01T00:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'}):k;
    cards.push(chartCard('ds-trend',`📈 ${prim.name} over time (${{y:'yearly',m:'monthly',d:'daily'}[gran]})`,{type:'area',labels:g.map(x=>lab(x.k)),series:[{name:prim.name,data:g.map(x=>x.v)},...(second?[{name:second.name,data:g.map(x=>g2.get(x.k)),kind:'line',color:'var(--c3)'}]:[])],fmt:compact,tf:compact},{span:8,sw:true}));
    if(g.length>=2){const ch=growth(lastOf(g).v,g[0].v),pk=g.reduce((a,b)=>b.v>a.v?b:a);if(isNum(ch))P(ch>=0?'pos':'neg',ch>=0?'📈':'📉',`${esc(prim.name)} moved <b>${ch>=0?'+':''}${ch.toFixed(1)}%</b> from ${lab(g[0].k)} to ${lab(lastOf(g).k)}; peak in <b>${lab(pk.k)}</b> (${compact(pk.v)}).`)}}
  if(prim&&cats[0]){const c=cats[0],g=groupAgg(recs,r=>r[c.i],prim.i,prim.agg).sort((a,b)=>b.v-a.v),top=g.slice(0,12);
    cards.push(chartCard('ds-cat',`🏷️ ${prim.name} by ${c.name}`,{type:'hbar',multi:true,items:top.map(x=>({label:String(x.k),value:x.v})),fmt:compact,tf:compact},{span:dates[0]?4:6}));
    if(prim.agg==='sum'&&g.length>1){const tot=g.reduce((a,b)=>a+(b.v||0),0);if(tot>0){P('pos','🥇',`<b>${esc(g[0].k)}</b> is the top ${esc(c.name)}, contributing <b>${(g[0].v/tot*100).toFixed(1)}%</b> of total ${esc(prim.name)}.`);const t3=g.slice(0,3).reduce((a,b)=>a+b.v,0)/tot*100;if(g.length>4)P(t3>70?'neu':'pos','🎯',`Top 3 ${esc(c.name)} values account for ${t3.toFixed(0)}% — ${t3>70?'high concentration':'well diversified'}.`)}}}
  const sc=cats.find(c=>c.distinct<=10&&c!==cats[0])||cats.find(c=>c.distinct<=10);
  if(prim&&sc){const g=groupAgg(recs,r=>r[sc.i],prim.i,prim.agg==='sum'?'sum':'avg').filter(x=>x.v>0).sort((a,b)=>b.v-a.v);
    cards.push(chartCard('ds-share',`🍩 Share of ${prim.name} by ${sc.name}`,{type:'doughnut',items:g.slice(0,7).map(x=>({label:String(x.k),value:x.v})).concat(g.length>7?[{label:'Others',value:g.slice(7).reduce((a,b)=>a+b.v,0)}]:[]),tf:compact},{span:4}))}
  if(prim&&cats.length>=2){const a=cats[0],b=cats.find(c=>c!==a&&c.distinct<=6);if(b){const ka=groupAgg(recs,r=>r[a.i],prim.i,'sum').sort((x,y)=>y.v-x.v).slice(0,8).map(x=>x.k),kb=[...new Set(recs.map(r=>r[b.i]))].filter(v=>v!=='').slice(0,6);
    cards.push(chartCard('ds-matrix',`🧱 ${prim.name}: ${a.name} × ${b.name}`,{type:'bar',stacked:true,labels:ka.map(String),series:kb.map(v=>({name:String(v),data:ka.map(k=>aggr(recs.filter(r=>r[a.i]===k&&r[b.i]===v).map(r=>r[prim.i]),prim.agg))})),fmt:compact,tf:compact},{span:8,sw:true}))}}
  if(prim){const v=recs.map(r=>r[prim.i]).filter(isNum);if(v.length>5){const lo=Math.min(...v),hi=Math.max(...v),nb=12,w=(hi-lo)/nb||1,bins=Array(nb).fill(0);v.forEach(x=>bins[Math.min(nb-1,Math.floor((x-lo)/w))]++);
    cards.push(chartCard('ds-hist',`📊 Distribution of ${prim.name}`,{type:'bar',labels:bins.map((_,k)=>compact(lo+k*w)),series:[{name:'Records',data:bins,color:'var(--c6)'}],fmt:compact,tf:v2=>v2+' records'},{span:4}));
    const mean=v.reduce((a,b)=>a+b)/v.length,sd=Math.sqrt(v.reduce((a,b)=>a+(b-mean)**2,0)/v.length),out=sd?v.filter(x=>Math.abs(x-mean)>3*sd).length:0;if(out)P('neu','🚩',`${out} outlier value(s) in ${esc(prim.name)} (more than 3 standard deviations from the mean).`)}}
  if(nums.length>=2){let best=null;for(let a=0;a<nums.length;a++)for(let b=a+1;b<nums.length;b++){const r=corr(recs.map(x=>x[nums[a].i]),recs.map(x=>x[nums[b].i]));if(isNum(r)&&(!best||Math.abs(r)>Math.abs(best.r)))best={a:nums[a],b:nums[b],r}}
    if(best){cards.push(chartCard('ds-scatter',`🔗 ${best.a.name} vs ${best.b.name} (r = ${best.r.toFixed(2)})`,{type:'scatter',xName:best.a.name,yName:best.b.name,points:recs.map(r=>({x:r[best.a.i],y:r[best.b.i],label:cats[0]?r[cats[0].i]:''})),height:300},{span:dates[0]?4:6}));
      if(Math.abs(best.r)>=0.5)P('neu','🔗',`${Math.abs(best.r)>=0.8?'Very strong':'Strong'} ${best.r>0?'positive':'negative'} relationship between <b>${esc(best.a.name)}</b> and <b>${esc(best.b.name)}</b> (r = ${best.r.toFixed(2)}).`)}}
  cols.filter(c=>c.blank/Math.max(ds.recs.length,1)>0.1).forEach(c=>P('neg','🕳️',`${esc(c.name)} has ${(c.blank/ds.recs.length*100).toFixed(0)}% missing values.`));
  cards.push(card('ds-ins','💡 Auto Insights',insightsHTML(ins),{span:cards.length%2?4:12}));
  cards.push(card('ds-table','📋 Data Table',`<div id="ds-table">${dsTable(recs)}</div>`,{span:12}));
  return kpiRow(ks)+grid('smart-'+norm(ds.cols.map(c=>c.name).join('')).slice(0,30),cards)}
function dsTable(recs){const ds=S.ds,cols=ds.cols,PG=25;if(ds.sort){const{j,d}=ds.sort;recs=recs.slice().sort((a,b)=>{const x=a[j],y=b[j];if(isNum(x)||isNum(y))return d*((isNum(x)?x:-Infinity)-(isNum(y)?y:-Infinity));return d*String(x??'').localeCompare(String(y??''))})}
  const pages=Math.max(1,Math.ceil(recs.length/PG)),p=Math.min(ds.page,pages-1),rows=recs.slice(p*PG,p*PG+PG);
  return`<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map(c=>`<th class="${c.type==='num'?'num':''}" data-act="ds-sort" data-j="${c.i}">${esc(c.name)}${ds.sort&&ds.sort.j===c.i?(ds.sort.d>0?' ▲':' ▼'):''}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td class="${c.type==='num'?'num':''}">${c.type==='num'?(isNum(r[c.i])?(+r[c.i].toFixed(2)).toLocaleString():'—'):esc(r[c.i]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
   <div class="pager">${recs.length.toLocaleString()} rows · page ${p+1} of ${pages}<button class="btn sm" data-act="ds-page" data-d="-1" ${p?'':'disabled'}>◀</button><button class="btn sm" data-act="ds-page" data-d="1" ${p<pages-1?'':'disabled'}>▶</button><button class="btn sm" data-act="ds-csv">⬇️ CSV</button></div>`}
function sampleSales(){const R=rng(7),reg=['North','South','East','West'],pr={Laptops:55000,Phones:22000,Tablets:28000,Accessories:1500,Monitors:12000},ch=['Online','Retail','Distributor'],P=Object.keys(pr);
  const rows=[['Date','Region','Product','Channel','Units','Revenue','Cost','Profit','Discount %']],list=[];
  for(let k=0;k<420;k++){const day=Math.floor(R()*730),d=new Date(Date.UTC(2024,3,1)+day*864e5),p=P[Math.floor(R()*P.length)],rg=reg[Math.floor(R()*4)],u=1+Math.floor(R()*30*(rg==='West'?1.5:1)*(p==='Accessories'?3:1));
    const rev=Math.round(u*pr[p]*(0.9+R()*0.2)*(1+day/1500)),cost=Math.round(rev*(0.62+R()*0.16));list.push([d.toISOString().slice(0,10),rg,p,ch[Math.floor(R()*3)],u,rev,cost,rev-cost,Math.round(R()*15)])}
  return rows.concat(list.sort((a,b)=>a[0]<b[0]?-1:1))}

/* ---------- Demo company (fictional) ---------- */
function makeDemo(){const R=rng(42);
  const build=(dates,revs,q)=>{const inc={},bal={},cf={},put=(o,k,v)=>(o[k]=o[k]||[]).push(v);
    revs.forEach((rev,j)=>{const f=q?4:1,cogs=rev*(0.57+R()*0.03),opex=rev*(0.19+R()*0.02),ebitda=rev-cogs-opex,dep=rev*0.035,ebit=ebitda-dep,intr=rev*Math.max(0.004,0.02-j*0.002),pbt=ebit-intr+rev*0.008,tax=pbt*0.252,ni=pbt-tax;
      [['Total Revenue',rev],['Cost Of Revenue',cogs],['Gross Profit',rev-cogs],['Operating Expense',opex],['EBITDA',ebitda],['Reconciled Depreciation',dep],['EBIT',ebit],['Interest Expense',intr],['Pretax Income',pbt],['Tax Provision',tax],['Net Income',ni],['Diluted EPS',ni/1.2e8]].forEach(([k,v])=>put(inc,k,v));
      const ar=rev*f,ta=ar*1.05,eq=ta*(0.48+j*0.015),debt=ta*Math.max(0.05,0.22-j*0.018),ca=ta*0.45,cl=ta*(0.25-j*0.004),cash=ta*(0.06+j*0.006);
      [['Total Assets',ta],['Current Assets',ca],['Current Liabilities',cl],['Inventory',ar*(0.14-j*0.004)],['Accounts Receivable',ar*(0.17-j*0.003)],['Accounts Payable',ar*0.1],['Cash And Cash Equivalents',cash],['Net PPE',ta*0.38],['Investments And Advances',ta*0.08],['Total Debt',debt],['Long Term Debt',debt*0.7],['Current Debt',debt*0.3],['Capital Stock',1.2e9],['Stockholders Equity',eq],['Total Liabilities Net Minority Interest',ta-eq]].forEach(([k,v])=>put(bal,k,v));
      const ocf=ni*(1.05+R()*0.25)+dep,capex=-rev*(0.05+R()*0.03),icf=capex-rev*0.01,div=-ni*0.3,fin=div-rev*0.02;
      [['Operating Cash Flow',ocf],['Capital Expenditure',capex],['Investing Cash Flow',icf],['Cash Dividends Paid',div],['Financing Cash Flow',fin],['Free Cash Flow',ocf+capex]].forEach(([k,v])=>put(cf,k,v))});
    return{income:{periods:dates,items:inc},balance:{periods:dates,items:bal},cashflow:{periods:dates,items:cf}}};
  const aD=['2022-03-31','2023-03-31','2024-03-31','2025-03-31','2026-03-31'],aR=[4200,4750,5260,5710,6380].map(x=>x*1e7);
  const qD=['2024-09-30','2024-12-31','2025-03-31','2025-06-30','2025-09-30','2025-12-31','2026-03-31','2026-06-30'],qR=[1390,1470,1560,1440,1540,1640,1760,1610].map(x=>x*1e7);
  let px=900;const price=[];for(let k=0;k<60;k++){px*=1+(R()-0.44)*0.08;const d=new Date(Date.UTC(2021,8+k,1));price.push([d.toISOString().slice(0,10),+px.toFixed(2)])}
  return{symbol:'DEMO',name:'Demo Industries Ltd (sample data)',source:'Built-in fictional sample',fetchedAt:new Date().toISOString(),
    info:{currency:'INR',financialCurrency:'INR',sector:'Industrials',industry:'Specialty Machinery (fictional)',exchange:'DEMO',currentPrice:px,marketCap:px*1.2e8,trailingPE:px*1.2e8/(aR[4]*0.095),priceToBook:4.1,dividendYield:0.9,fiftyTwoWeekHigh:px*1.18,fiftyTwoWeekLow:px*0.78,beta:0.92,
      longBusinessSummary:'Demo Industries is a FICTIONAL company used to demonstrate Company Analyser. All figures are synthetic. Search for a real listed company (e.g. Infosys, Reliance, TCS) to analyse actual published results.'},
    annual:build(aD,aR,false),quarterly:build(qD,qR,true),price}}
function finTemplate(){const co=makeDemo(),MA=buildModel(co,'annual'),s3=s3Build(MA),d=unitOf('INR').d;
  const rows=[['Particulars (₹ in Crore) — Schedule III, Division II',...MA.periods.map(p=>'Mar '+p.slice(0,4))]];
  const add=(title,list)=>{rows.push([title]);list.filter(r=>r.x&&r.v&&r.v.some(isNum)&&!r.bal).forEach(r=>rows.push([r.x,...r.v.map(v=>isNum(v)?(r.k==='eps'?v:v/d).toFixed(2):'')]))};
  add('BALANCE SHEET',s3.bs);add('STATEMENT OF PROFIT AND LOSS',s3.pl);add('STATEMENT OF CASH FLOWS',s3.cf);
  downloadText(toCSV(rows),'Schedule_III_Financial_Statement_Template.csv')}
/* ======================= Schedule III, Division II (Ind AS) — statements & ratios ======================= */
/* Captions follow Division II of Schedule III to the Companies Act, 2013 (Ind AS companies), as amended by MCA
   notification of 24 March 2021; the Statement of Cash Flows follows Ind AS 7 (indirect method).
   Source data (Yahoo's standardised items, or an uploaded statement) is re-arranged into these captions. */
const S3N={
 ppe:['Property Plant And Equipment','Net PPE','Fixed Assets','Net Block'],cwip:['Capital Work In Progress','Construction In Progress','CWIP'],
 invProp:['Investment Property','Investment Properties'],goodwill:['Goodwill'],intang:['Other Intangible Assets','Intangible Assets'],
 intangDev:['Intangible Assets Under Development'],bio:['Biological Assets Other Than Bearer Plants'],
 ncInv:['Non Current Investments','Investments And Advances','Long Term Equity Investment','Investments'],
 ncRecv:['Non Current Trade Receivables','Non Current Accounts Receivable'],ncLoans:['Non Current Loans','Non Current Note Receivables'],
 ncOthFA:['Non Current Other Financial Assets'],dta:['Deferred Tax Assets Net','Deferred Tax Assets','Non Current Deferred Taxes Assets'],
 ncOther:['Other Non Current Assets'],totalNCA:['Total Non Current Assets'],
 inventory:['Inventories','Inventory'],curInv:['Current Investments','Other Short Term Investments'],
 recv:['Trade Receivables','Current Trade Receivables','Accounts Receivable','Receivables','Sundry Debtors'],cash:['Cash And Cash Equivalents'],
 bank:['Bank Balances Other Than Cash And Cash Equivalents','Other Bank Balances'],curLoans:['Current Loans','Loans Receivable'],
 curOthFA:['Current Other Financial Assets'],curTaxA:['Current Tax Assets Net','Current Tax Assets','Taxes Receivable'],
 curOther:['Other Current Assets'],totalCA:['Total Current Assets','Current Assets'],totalAssets:['Total Assets'],
 shareCap:['Equity Share Capital','Share Capital','Equity Capital','Capital Stock','Common Stock'],otherEq:['Other Equity','Reserves And Surplus','Reserves'],
 ownersEq:['Equity Attributable To Owners','Stockholders Equity','Common Stock Equity','Shareholders Funds','Net Worth'],
 nci:['Non Controlling Interests','Non Controlling Interest','Minority Interest'],totalEq:['Total Equity','Total Equity Gross Minority Interest'],
 ncBorrow:['Non Current Borrowings','Long Term Borrowings','Long Term Debt'],ncLease:['Non Current Lease Liabilities','Long Term Capital Lease Obligation'],
 ncPay:['Non Current Trade Payables','Tradeand Other Payables Non Current'],ncOthFL:['Non Current Other Financial Liabilities'],
 ncProv:['Non Current Provisions','Long Term Provisions','Non Current Pension And Other Postretirement Benefit Plans'],
 dtl:['Deferred Tax Liabilities Net','Deferred Tax Liabilities','Non Current Deferred Taxes Liabilities'],ncOtherL:['Other Non Current Liabilities'],
 totalNCL:['Total Non Current Liabilities','Total Non Current Liabilities Net Minority Interest'],
 curBorrow:['Current Borrowings','Short Term Borrowings','Current Debt'],curLease:['Current Lease Liabilities','Current Capital Lease Obligation'],
 pay:['Trade Payables','Current Trade Payables','Accounts Payable','Payables','Sundry Creditors'],
 payMSME:['Trade Payables Micro And Small Enterprises','Total Outstanding Dues Of Micro Enterprises And Small Enterprises'],
 curOthFL:['Current Other Financial Liabilities'],curOtherL:['Other Current Liabilities'],curProv:['Current Provisions','Short Term Provisions'],
 curTaxL:['Current Tax Liabilities Net','Current Tax Liabilities','Income Tax Payable'],
 totalCL:['Total Current Liabilities','Current Liabilities'],totalLiab:['Total Liabilities','Total Liabilities Net Minority Interest'],
 debt:['Total Debt','Borrowings','Total Borrowings'],
 rev:['Revenue From Operations','Operating Revenue','Total Revenue','Net Sales','Sales'],otherInc:['Other Income'],
 matCost:['Cost Of Materials Consumed','Cost Of Revenue','Reconciled Cost Of Revenue'],purchases:['Purchases Of Stock In Trade'],
 invChange:['Changes In Inventories Of Finished Goods Stock In Trade And Work In Progress','Changes In Inventories'],
 emp:['Employee Benefits Expense','Employee Benefit Expense','Salaries And Wages','Employee Cost'],
 fin:['Finance Costs','Finance Cost','Interest Expense','Interest Expense Non Operating','Interest'],
 dep:['Depreciation And Amortisation Expense','Depreciation And Amortization Expense','Depreciation And Amortization In Income Statement','Reconciled Depreciation','Depreciation And Amortisation','Depreciation'],
 otherExp:['Other Expenses'],opInc:['Operating Income','Total Operating Income As Reported'],exceptional:['Exceptional Items'],unusual:['Total Unusual Items'],
 pbt:['Profit Before Tax','Pretax Income','PBT'],curTax:['Current Tax'],defTaxPL:['Deferred Tax'],tax:['Tax Expense','Total Tax Expense','Tax Provision'],
 disc:['Profit From Discontinued Operations After Tax','Net Income Discontinuous Operations'],
 pat:['Profit For The Year','Profit For The Period','Net Income Including Noncontrolling Interests','Profit After Tax','Net Profit'],
 patOwners:['Profit Attributable To Owners','Net Income Common Stockholders','Net Income'],oci:['Other Comprehensive Income','Total Other Comprehensive Income'],
 epsB:['Basic EPS','Basic Earnings Per Share','EPS'],epsD:['Diluted EPS','Diluted Earnings Per Share'],
 ocf:['Net Cash From Operating Activities','Cash From Operating Activity','Operating Cash Flow','Cash Flow From Continuing Operating Activities'],
 cfDep:['Depreciation And Amortization','Depreciation Amortization Depletion','Depreciation And Amortisation','Depreciation'],cfDefTax:['Deferred Income Tax','Deferred Tax'],
 cfWC:['Change In Working Capital','Changes In Working Capital'],cfRecv:['Change In Receivables','Change In Trade Receivables','Changes In Account Receivables'],
 cfInv:['Change In Inventory','Change In Inventories'],cfPay:['Change In Payables And Accrued Expense','Change In Trade Payables','Change In Payable','Change In Account Payable'],
 cfTax:['Income Taxes Paid','Taxes Refund Paid','Income Tax Paid Supplemental Data'],
 icf:['Net Cash From Investing Activities','Cash From Investing Activity','Investing Cash Flow','Cash Flow From Continuing Investing Activities'],
 capex:['Purchase Of Property Plant And Equipment','Purchase Of PPE','Purchase Of Fixed Assets','Capital Expenditure'],
 salePPE:['Sale Of Property Plant And Equipment','Sale Of PPE','Sale Of Fixed Assets'],buyInv:['Purchase Of Investments','Purchase Of Investment'],
 sellInv:['Sale Of Investments','Sale Of Investment'],acq:['Acquisition Of Subsidiaries','Purchase Of Business'],
 intRec:['Interest Received','Interest Received CFI'],divRec:['Dividends Received','Dividends Received CFI'],
 fincf:['Net Cash From Financing Activities','Cash From Financing Activity','Financing Cash Flow','Cash Flow From Continuing Financing Activities'],
 shareIss:['Proceeds From Issue Of Shares','Common Stock Issuance','Issuance Of Capital Stock'],buyback:['Buyback Of Shares','Repurchase Of Capital Stock','Common Stock Payments'],
 borrowIn:['Proceeds From Borrowings','Issuance Of Debt','Long Term Debt Issuance'],borrowOut:['Repayment Of Borrowings','Repayment Of Debt','Long Term Debt Payments'],
 leasePay:['Payment Of Lease Liabilities'],intPaid:['Interest Paid','Interest Paid CFF'],divPaid:['Dividends Paid','Cash Dividends Paid','Common Stock Dividend Paid'],
 fxEff:['Effect Of Exchange Rate Changes'],cashOpen:['Opening Cash And Cash Equivalents','Beginning Cash Position'],
 cashClose:['Closing Cash And Cash Equivalents','End Cash Position'],
};
function s3series(F,st,key,P){const b=F&&F[st];const none={v:P.map(()=>null),name:null};if(!b||!b.items)return none;
  const keys=Object.keys(b.items).filter(k=>!k.includes('%')),nk=keys.map(norm);
  const take=j=>{const a=align(b.periods,b.items[keys[j]],P);return a.some(isNum)?{v:a,name:keys[j]}:null};
  for(const n of S3N[key]){const j=nk.indexOf(norm(n));if(j>=0){const r=take(j);if(r)return r}}
  if(b.fuzzy)for(const n of S3N[key]){const t=norm(n);if(t.length<8)continue;const j=nk.findIndex(k=>k.startsWith(t));if(j>=0){const r=take(j);if(r)return r}}
  return none}
const s3sum=(...a)=>a.some(isNum)?a.reduce((s,v)=>s+(isNum(v)?v:0),0):null;
const s3nz=v=>isNum(v)?v:0;
const S3_MEMO=new Map();
function s3Build(M){
  const memoKey=M.co.symbol+'|'+M.freq+'|'+M.periods.join();if(S3_MEMO.has(memoKey))return S3_MEMO.get(memoKey);
  const F=M.co[M.freq],P=M.periods,V=f=>P.map((_,i)=>f(i)),G={};
  const g=(k,st)=>{G[k]=s3series(F,st,k,P);return G[k].v},B=k=>g(k,'balance'),L=k=>g(k,'income'),C=k=>g(k,'cashflow');
  const sumA=(arrs,i)=>arrs.reduce((s,a)=>s+s3nz(a[i]),0),has=a=>a.some(isNum);
  const row=(c,d,lbl,v,x,bal,note,k)=>({c,d,lbl,v,x,bal,note,k});
  const H=l=>row('h',0,l),H2=l=>row('h2',0,l),H3=(l,d=1)=>row('h3',d,l);
  const L0=(l,v,x,b,n)=>row('',0,l,v,x,b,n),L1=(l,v,x,b,n)=>row('',1,l,v,x,b,n),L2=(l,v,x,b,n)=>row('',2,l,v,x,b,n),L3=(l,v,x,b,n)=>row('',3,l,v,x,b,n);
  const T=(l,v,x)=>row('tot',0,l,v,x),GT=(l,v,x)=>row('gt',0,l,v,x);
  // ---------------- Balance Sheet
  const cwip=B('cwip'),ppeRaw=B('ppe');
  const ppe=V(i=>norm(G.ppe.name||'')==='netppe'&&isNum(ppeRaw[i])&&isNum(cwip[i])&&ppeRaw[i]>cwip[i]?ppeRaw[i]-cwip[i]:ppeRaw[i]); // Yahoo's Net PPE includes CWIP
  const invProp=B('invProp'),gw=B('goodwill'),intang=B('intang'),intangDev=B('intangDev'),bio=B('bio'),ncInv=B('ncInv'),ncRecv=B('ncRecv'),
    ncLoans=B('ncLoans'),ncOthFA=B('ncOthFA'),dta=B('dta'),ncOtherSrc=B('ncOther'),tNCA=B('totalNCA'),TAsrc=B('totalAssets'),CA=B('totalCA');
  const NCA=V(i=>isNum(tNCA[i])?tNCA[i]:sub(TAsrc[i],CA[i]));
  const ncOther=V(i=>isNum(NCA[i])?NCA[i]-sumA([ppe,cwip,invProp,gw,intang,intangDev,bio,ncInv,ncRecv,ncLoans,ncOthFA,dta],i):ncOtherSrc[i]);
  const inv=B('inventory'),curInv=B('curInv'),recv=B('recv'),cash=B('cash'),bank=B('bank'),curLoans=B('curLoans'),curOthFA=B('curOthFA'),curTaxA=B('curTaxA'),curOtherSrc=B('curOther');
  const curOther=V(i=>isNum(CA[i])?CA[i]-sumA([inv,curInv,recv,cash,bank,curLoans,curOthFA,curTaxA],i):curOtherSrc[i]);
  const TA=V(i=>isNum(TAsrc[i])?TAsrc[i]:s3sum(NCA[i],CA[i]));
  const cap=B('shareCap'),oeSrc=B('otherEq'),ownSrc=B('ownersEq'),nci=B('nci'),teSrc=B('totalEq');
  const owners=V(i=>isNum(ownSrc[i])?ownSrc[i]:(isNum(cap[i])||isNum(oeSrc[i])?s3sum(cap[i],oeSrc[i]):null));
  const oe=V(i=>isNum(ownSrc[i])?sub(owners[i],cap[i]):oeSrc[i]);
  const TE=V(i=>isNum(teSrc[i])?teSrc[i]:(isNum(owners[i])?s3sum(owners[i],nci[i]):null));
  const tlRaw=B('totalLiab'),TL=V(i=>isNum(tlRaw[i])&&isNum(TA[i])&&Math.abs(tlRaw[i]-TA[i])<Math.abs(TA[i])*0.005?null:tlRaw[i]); // Screener's "Total Liabilities" = balance-sheet total
  const CL=B('totalCL'),tNCL=B('totalNCL');
  const NCL=V(i=>isNum(tNCL[i])?tNCL[i]:isNum(TL[i])&&isNum(CL[i])?TL[i]-CL[i]:isNum(TA[i])&&isNum(TE[i])&&isNum(CL[i])?TA[i]-TE[i]-CL[i]:null);
  const ncB=B('ncBorrow'),ncLe=B('ncLease'),ncP=B('ncPay'),ncOFL=B('ncOthFL'),ncPr=B('ncProv'),dtl=B('dtl'),ncOLsrc=B('ncOtherL');
  const ncOL=V(i=>isNum(NCL[i])?NCL[i]-sumA([ncB,ncLe,ncP,ncOFL,ncPr,dtl],i):ncOLsrc[i]);
  const cB=B('curBorrow'),cLe=B('curLease'),pay=B('pay'),msme=B('payMSME'),cOFL=B('curOthFL'),cPr=B('curProv'),cTL=B('curTaxL'),cOLsrc=B('curOtherL');
  const cOL=V(i=>isNum(CL[i])?CL[i]-sumA([cB,cLe,pay,cOFL,cPr,cTL],i):cOLsrc[i]);
  const payOth=V(i=>isNum(msme[i])&&isNum(pay[i])?pay[i]-msme[i]:null);
  const TEL=V(i=>isNum(TE[i])&&isNum(NCL[i])&&isNum(CL[i])?TE[i]+NCL[i]+CL[i]:null);
  const debtSrc=B('debt'),debt=V(i=>{const s=s3sum(ncB[i],cB[i],ncLe[i],cLe[i]);return isNum(s)&&s!==0?s:debtSrc[i]});
  const bs=[H('I. ASSETS'),H2('(1) Non-current assets'),
    L1('(a) Property, Plant and Equipment',ppe,'Property Plant And Equipment'),L1('(b) Capital work-in-progress',cwip,'Capital Work In Progress'),
    L1('(c) Investment Property',invProp,'Investment Property'),L1('(d) Goodwill',gw,'Goodwill'),L1('(e) Other Intangible assets',intang,'Other Intangible Assets'),
    L1('(f) Intangible assets under development',intangDev,'Intangible Assets Under Development'),L1('(g) Biological Assets other than bearer plants',bio,'Biological Assets Other Than Bearer Plants'),
    H3('(h) Financial Assets'),L2('(i) Investments',ncInv,'Non Current Investments'),L2('(ii) Trade receivables',ncRecv,'Non Current Trade Receivables'),
    L2('(iii) Loans',ncLoans,'Non Current Loans'),L2('(iv) Others',ncOthFA,'Non Current Other Financial Assets'),
    L1('(i) Deferred tax assets (net)',dta,'Deferred Tax Assets Net'),L1('(j) Other non-current assets',ncOther,'Other Non Current Assets',1),
    T('Total non-current assets',NCA,'Total Non Current Assets'),
    H2('(2) Current assets'),L1('(a) Inventories',inv,'Inventories'),H3('(b) Financial Assets'),
    L2('(i) Investments',curInv,'Current Investments'),L2('(ii) Trade receivables',recv,'Trade Receivables'),L2('(iii) Cash and cash equivalents',cash,'Cash And Cash Equivalents'),
    L2('(iv) Bank balances other than (iii) above',bank,'Bank Balances Other Than Cash And Cash Equivalents'),L2('(v) Loans',curLoans,'Current Loans'),
    L2('(vi) Others',curOthFA,'Current Other Financial Assets'),L1('(c) Current Tax Assets (Net)',curTaxA,'Current Tax Assets Net'),
    L1('(d) Other current assets',curOther,'Other Current Assets',1),T('Total current assets',CA,'Total Current Assets'),
    GT('TOTAL ASSETS',TA,'Total Assets'),
    H('II. EQUITY AND LIABILITIES'),H2('Equity'),L1('(a) Equity Share capital',cap,'Equity Share Capital'),L1('(b) Other Equity',oe,'Other Equity'),
    ...(has(nci)?[T('Equity attributable to owners of the Company',owners),L1('Non-controlling interests',nci,'Non Controlling Interests')]:[]),
    T('Total equity',TE,'Total Equity'),
    H2('Liabilities'),H2('(1) Non-current liabilities'),H3('(a) Financial Liabilities'),
    L2('(i) Borrowings',ncB,'Non Current Borrowings'),L2('(ia) Lease liabilities',ncLe,'Non Current Lease Liabilities'),
    L2('(ii) Trade payables',ncP,'Non Current Trade Payables'),L2('(iii) Other financial liabilities',ncOFL,'Non Current Other Financial Liabilities'),
    L1('(b) Provisions',ncPr,'Non Current Provisions'),L1('(c) Deferred tax liabilities (Net)',dtl,'Deferred Tax Liabilities Net'),
    L1('(d) Other non-current liabilities',ncOL,'Other Non Current Liabilities',1),T('Total non-current liabilities',NCL,'Total Non Current Liabilities'),
    H2('(2) Current liabilities'),H3('(a) Financial Liabilities'),L2('(i) Borrowings',cB,'Current Borrowings'),L2('(ia) Lease liabilities',cLe,'Current Lease Liabilities'),
    L2('(ii) Trade payables',pay,'Trade Payables',0,has(msme)?'':'Split between micro & small enterprises and others is not available in the source data'),
    L3('(A) total outstanding dues of micro enterprises and small enterprises',msme,'Trade Payables Micro And Small Enterprises'),
    L3('(B) total outstanding dues of creditors other than micro enterprises and small enterprises',payOth),
    L2('(iii) Other financial liabilities',cOFL,'Current Other Financial Liabilities'),L1('(b) Other current liabilities',cOL,'Other Current Liabilities',1),
    L1('(c) Provisions',cPr,'Current Provisions'),L1('(d) Current Tax Liabilities (Net)',cTL,'Current Tax Liabilities Net'),
    T('Total current liabilities',CL,'Total Current Liabilities'),GT('TOTAL EQUITY AND LIABILITIES',TEL)];
  // ---------------- Statement of Profit and Loss
  const R=L('rev'),oiSrc=L('otherInc'),finA=L('fin'),Fc=V(i=>absN(finA[i])),depA=L('dep'),cfDepA=C('cfDep');
  const D=V(i=>isNum(depA[i])?Math.abs(depA[i]):absN(cfDepA[i]));
  const pbt=L('pbt'),opInc=L('opInc'),excA=L('exceptional'),unu=L('unusual');
  const Ex=V(i=>isNum(excA[i])?excA[i]:isNum(unu[i])&&unu[i]!==0?-unu[i]:null);          // exceptional items, shown as a deduction
  const OI=V(i=>isNum(oiSrc[i])?oiSrc[i]:isNum(opInc[i])&&isNum(pbt[i])?pbt[i]-opInc[i]+s3nz(Fc[i])+s3nz(Ex[i]):null);
  const TI=V(i=>isNum(R[i])?R[i]+s3nz(OI[i]):null),Vp=V(i=>isNum(pbt[i])?pbt[i]+s3nz(Ex[i]):null),TX=V(i=>isNum(TI[i])&&isNum(Vp[i])?TI[i]-Vp[i]:null);
  const matOrig=L('matCost'),mat=[...matOrig],pur=L('purchases'),chg=L('invChange'),emp=[...L('emp')],othSrc=L('otherExp');
  const OX=V(i=>{if(!isNum(TX[i]))return othSrc[i];const tol=Math.abs(TX[i])*0.001;
    let o=TX[i]-s3nz(mat[i])-s3nz(pur[i])-s3nz(chg[i])-s3nz(emp[i])-s3nz(Fc[i])-s3nz(D[i]);
    if(o<-tol&&isNum(emp[i])){o+=emp[i];emp[i]=null}      // source cost lines overlap: fold them into other expenses
    if(o<-tol&&isNum(mat[i])){o+=mat[i];mat[i]=null}
    return o});
  const taxA=L('tax'),ctSrc=L('curTax'),dtPL=L('defTaxPL'),cfDef=C('cfDefTax');
  const TXE=V(i=>isNum(taxA[i])?taxA[i]:s3sum(ctSrc[i],dtPL[i]));
  // Indian cash-flow statements add back the WHOLE tax expense, which Yahoo labels "Deferred Tax" — only trust it when clearly smaller
  const dtax=V(i=>isNum(dtPL[i])?dtPL[i]:isNum(cfDef[i])&&isNum(TXE[i])&&Math.abs(cfDef[i])<0.9*Math.abs(TXE[i])?cfDef[i]:null);
  const ctax=V(i=>isNum(ctSrc[i])?ctSrc[i]:isNum(TXE[i])&&isNum(dtax[i])?TXE[i]-dtax[i]:null);
  const IX=V(i=>sub(pbt[i],TXE[i])),disc=L('disc'),patSrc=L('pat');
  const XIII=V(i=>isNum(patSrc[i])?patSrc[i]:isNum(IX[i])?IX[i]+s3nz(disc[i]):null);
  const own=L('patOwners'),nciP=V(i=>isNum(own[i])&&isNum(XIII[i])&&Math.abs(XIII[i]-own[i])>Math.abs(XIII[i])*0.0005?XIII[i]-own[i]:null);
  const oci=L('oci'),TCI=V(i=>isNum(oci[i])&&isNum(XIII[i])?XIII[i]+oci[i]:null),epsB=L('epsB'),epsD=L('epsD');
  const combined=G.matCost.name&&/revenue/i.test(G.matCost.name);
  const pl=[L0('I. Revenue from operations',R,'Revenue From Operations'),L0('II. Other income',OI,'Other Income',!has(oiSrc)),
    T('III. Total income (I + II)',TI,'Total Income'),H('IV. EXPENSES'),
    L1(combined?'Cost of revenue (as reported)':'Cost of materials consumed',mat,'Cost Of Materials Consumed',0,combined?'The source reports a single “cost of revenue” (materials, purchases, inventory changes and other direct costs such as sub-contracting), so it cannot be split into the Schedule III captions':''),
    L1('Purchases of Stock-in-Trade',pur,'Purchases Of Stock In Trade'),
    L1('Changes in inventories of finished goods, Stock-in-Trade and work-in-progress',chg,'Changes In Inventories'),
    L1('Employee benefits expense',emp,'Employee Benefits Expense'),L1('Finance costs',Fc,'Finance Costs'),
    L1('Depreciation and amortization expense',D,'Depreciation And Amortisation Expense'),L1('Other expenses',OX,'Other Expenses',1),
    T('Total expenses (IV)',TX,'Total Expenses'),
    T('V. Profit/(loss) before exceptional items and tax (III − IV)',Vp),L0('VI. Exceptional items',Ex,'Exceptional Items'),
    T('VII. Profit/(loss) before tax (V − VI)',pbt,'Profit Before Tax'),
    row('h2',0,'VIII. Tax expense',TXE,'Tax Expense',0,has(dtax)?'':'Split between current and deferred tax is not available in the source data'),
    L1('(1) Current tax',ctax,'Current Tax'),L1('(2) Deferred tax',dtax,'Deferred Tax'),
    T('IX. Profit/(loss) for the period from continuing operations (VII − VIII)',IX),
    L0('X. Profit/(loss) from discontinued operations',null),L0('XI. Tax expense of discontinued operations',null),
    L0('XII. Profit/(loss) from discontinued operations (after tax) (X − XI)',disc,'Profit From Discontinued Operations After Tax'),
    GT('XIII. Profit/(loss) for the period (IX + XII)',XIII,'Profit For The Year'),
    ...(has(nciP)?[H3('Profit/(loss) attributable to:',0),L1('Owners of the Company',own,'Profit Attributable To Owners'),L1('Non-controlling interests',nciP)]:[]),
    H('XIV. Other Comprehensive Income'),
    L1('A (i) Items that will not be reclassified to profit or loss',null),L1('   (ii) Income tax relating to items that will not be reclassified to profit or loss',null),
    L1('B (i) Items that will be reclassified to profit or loss',null),L1('   (ii) Income tax relating to items that will be reclassified to profit or loss',null),
    L1('Other comprehensive income for the period (net of tax)',oci,'Other Comprehensive Income',0,has(oci)?'':'Other comprehensive income is not available in the source data'),
    GT('XV. Total Comprehensive Income for the period (XIII + XIV)',TCI,'Total Comprehensive Income'),
    H('XVI. Earnings per equity share (for continuing operations):'),
    Object.assign(L1('(1) Basic',epsB,'Basic EPS'),{k:'eps'}),Object.assign(L1('(2) Diluted',epsD,'Diluted EPS'),{k:'eps'})];
  // ---------------- Statement of Cash Flows (Ind AS 7, indirect method)
  const pos=a=>a.map(v=>isNum(v)?Math.abs(v):null),neg=a=>a.map(v=>isNum(v)?-Math.abs(v):null);
  const ocf=C('ocf'),wc=C('cfWC'),cRecv=C('cfRecv'),cInv=C('cfInv'),cPay=C('cfPay'),taxRaw=C('cfTax');
  const taxPaid=V(i=>isNum(taxRaw[i])?(/supplemental/i.test(G.cfTax.name||'')?-Math.abs(taxRaw[i]):taxRaw[i]):null);
  const wcT=V(i=>isNum(wc[i])?wc[i]:s3sum(cRecv[i],cInv[i],cPay[i])),wcOther=V(i=>isNum(wc[i])?wc[i]-s3nz(cRecv[i])-s3nz(cInv[i])-s3nz(cPay[i]):null);
  const cashGen=V(i=>isNum(ocf[i])?ocf[i]-s3nz(taxPaid[i]):null),opbwc=V(i=>isNum(cashGen[i])?cashGen[i]-s3nz(wcT[i]):null);
  const cfD=V(i=>isNum(cfDepA[i])?Math.abs(cfDepA[i]):D[i]),otherAdj=V(i=>isNum(opbwc[i])&&isNum(pbt[i])?opbwc[i]-pbt[i]-s3nz(cfD[i])-s3nz(Fc[i]):null);
  const icf=C('icf'),capex=neg(C('capex')),salePPE=pos(C('salePPE')),buyInv=neg(C('buyInv')),sellInv=pos(C('sellInv')),acq=neg(C('acq')),intRec=pos(C('intRec')),divRec=pos(C('divRec'));
  const otherInv=V(i=>isNum(icf[i])?icf[i]-sumA([capex,salePPE,buyInv,sellInv,acq,intRec,divRec],i):null);
  const fincf=C('fincf'),shareIss=pos(C('shareIss')),buyback=neg(C('buyback')),borrowIn=pos(C('borrowIn')),borrowOut=neg(C('borrowOut')),
    leasePay=neg(C('leasePay')),intPaid=neg(C('intPaid')),divPaid=neg(C('divPaid'));
  const otherFin=V(i=>isNum(fincf[i])?fincf[i]-sumA([shareIss,buyback,borrowIn,borrowOut,leasePay,intPaid,divPaid],i):null);
  const netChg=V(i=>isNum(ocf[i])||isNum(icf[i])||isNum(fincf[i])?s3sum(ocf[i],icf[i],fincf[i]):null),fxE=C('fxEff'),open=C('cashOpen'),closeSrc=C('cashClose');
  const close=V(i=>isNum(closeSrc[i])?closeSrc[i]:isNum(open[i])&&isNum(netChg[i])?open[i]+netChg[i]+s3nz(fxE[i]):null);
  const cf=[H('A. CASH FLOW FROM OPERATING ACTIVITIES'),L1('Profit before tax',pbt,'Profit Before Tax'),H3('Adjustments for:'),
    L2('Depreciation and amortisation expense',cfD,'Depreciation And Amortisation Expense'),L2('Finance costs',Fc,'Finance Costs'),
    L2('Other non-cash items and adjustments (net)',otherAdj,'',1),T('Operating profit before working capital changes',opbwc),
    H3('Changes in working capital:'),L2('(Increase)/decrease in trade receivables',cRecv,'Change In Trade Receivables'),
    L2('(Increase)/decrease in inventories',cInv,'Change In Inventories'),L2('Increase/(decrease) in trade payables',cPay,'Change In Trade Payables'),
    L2('Other working capital changes (net)',wcOther,'',1),T('Cash generated from operations',cashGen),
    L1('Income taxes paid (net of refunds)',taxPaid,'Income Taxes Paid'),GT('Net cash from/(used in) operating activities (A)',ocf,'Net Cash From Operating Activities'),
    H('B. CASH FLOW FROM INVESTING ACTIVITIES'),L1('Purchase of property, plant and equipment and intangible assets',capex,'Purchase Of Property Plant And Equipment'),
    L1('Proceeds from sale of property, plant and equipment',salePPE,'Sale Of Property Plant And Equipment'),L1('Purchase of investments',buyInv,'Purchase Of Investments'),
    L1('Proceeds from sale/redemption of investments',sellInv,'Sale Of Investments'),L1('Acquisition of subsidiaries/businesses',acq,'Acquisition Of Subsidiaries'),
    L1('Interest received',intRec,'Interest Received'),L1('Dividends received',divRec,'Dividends Received'),L1('Other investing activities (net)',otherInv,'',1),
    GT('Net cash from/(used in) investing activities (B)',icf,'Net Cash From Investing Activities'),
    H('C. CASH FLOW FROM FINANCING ACTIVITIES'),L1('Proceeds from issue of equity shares',shareIss,'Proceeds From Issue Of Shares'),
    L1('Buy-back of equity shares',buyback,'Buyback Of Shares'),L1('Proceeds from borrowings',borrowIn,'Proceeds From Borrowings'),
    L1('Repayment of borrowings',borrowOut,'Repayment Of Borrowings'),L1('Payment of lease liabilities',leasePay,'Payment Of Lease Liabilities'),
    L1('Interest paid',intPaid,'Interest Paid'),L1('Dividends paid',divPaid,'Dividends Paid'),L1('Other financing activities (net)',otherFin,'',1),
    GT('Net cash from/(used in) financing activities (C)',fincf,'Net Cash From Financing Activities'),
    T('Net increase/(decrease) in cash and cash equivalents (A + B + C)',netChg),L1('Effect of exchange rate changes on cash and cash equivalents',fxE,'Effect Of Exchange Rate Changes'),
    L1('Cash and cash equivalents at the beginning of the period',open,'Opening Cash And Cash Equivalents'),
    GT('Cash and cash equivalents at the end of the period',close,'Closing Cash And Cash Equivalents')];
  const out={bs,pl,cf,diff:V(i=>sub(TEL[i],TA[i])),combined,
    val:{TA,CA,CL,TE,owners,debt,dtl,gw,intang,inv,recv,pay,cogs:matOrig,rev:R,oi:OI,pbt,F:Fc,D,pat:XIII,patOwners:V(i=>isNum(own[i])?own[i]:XIII[i]),
      borrowOut,leasePay,invest:V(i=>s3sum(ncInv[i],curInv[i]))}};
  S3_MEMO.set(memoKey,out);return out}

/* ---------- Schedule III "Additional Regulatory Information" ratios (MCA amendment, 24 March 2021) ---------- */
function s3Ratios(MA){const v=s3Build(MA).val,avg=(a,i)=>isNum(a[i])?(isNum(a[i-1])?(a[i]+a[i-1])/2:a[i]):null;
  const wc=MA.periods.map((_,i)=>sub(v.CA[i],v.CL[i]));
  const X=(n,num,den,u,f,proxy)=>({n,num,den,u,f,proxy});
  return[
   X('(a) Current Ratio','Current assets','Current liabilities','x',i=>rt(v.CA[i],v.CL[i])),
   X('(b) Debt-Equity Ratio','Total debt (borrowings incl. lease liabilities)','Total equity','x',i=>rt(v.debt[i],v.TE[i])),
   X('(c) Debt Service Coverage Ratio','Profit after tax + Depreciation & amortisation + Finance costs','Finance costs + Lease payments + Principal repayments','x',
     i=>rt(s3sum(v.pat[i],v.D[i],v.F[i]),s3sum(v.F[i],absN(v.leasePay[i]),absN(v.borrowOut[i])))),
   X('(d) Return on Equity (ROE)','Profit after tax attributable to owners','Average equity attributable to owners','%',i=>pc(v.patOwners[i],avg(v.owners,i))),
   X('(e) Inventory Turnover Ratio','Cost of goods sold (cost of revenue)','Average inventories','x',i=>rt(isNum(v.cogs[i])?v.cogs[i]:v.rev[i],avg(v.inv,i))),
   X('(f) Trade Receivables Turnover Ratio','Revenue from operations (net credit sales)','Average trade receivables','x',i=>rt(v.rev[i],avg(v.recv,i)),'Total revenue used for credit sales'),
   X('(g) Trade Payables Turnover Ratio','Purchases (cost of revenue used)','Average trade payables','x',i=>rt(v.cogs[i],avg(v.pay,i)),'Cost of revenue used for net credit purchases'),
   X('(h) Net Capital Turnover Ratio','Revenue from operations','Average working capital (current assets − current liabilities)','x',i=>rt(v.rev[i],avg(wc,i))),
   X('(i) Net Profit Ratio','Profit for the year','Revenue from operations','%',i=>pc(v.pat[i],v.rev[i])),
   X('(j) Return on Capital Employed (ROCE)','Earnings before interest and tax (PBT + finance costs)','Capital employed = Tangible net worth + Total debt + Deferred tax liability','%',
     i=>{const tnw=isNum(v.TE[i])?v.TE[i]-s3nz(v.gw[i])-s3nz(v.intang[i]):null;return pc(isNum(v.pbt[i])?v.pbt[i]+s3nz(v.F[i]):null,isNum(tnw)?tnw+s3nz(v.debt[i])+s3nz(v.dtl[i]):null)}),
   X('(k) Return on Investment','Income from investments (other income used)','Average investments (current + non-current)','%',i=>pc(v.oi[i],avg(v.invest,i)),'Other income used for income from treasury investments'),
  ]}
function s3RatioIndex(MA){if(S.freq==='annual')return selIndex(MA);const d=S.selDate&&new Date(S.selDate);if(!d)return MA.periods.length-1;
  let k=-1;MA.periods.forEach((p,j)=>{if(new Date(p)<=d)k=j});return k<0?MA.periods.length-1:k}
function s3RatiosHTML(co){const MA=getModel(co.symbol,'annual');if(!MA)return'<div class="empty">Schedule III ratios need annual financial statements.</div>';
  const i=s3RatioIndex(MA),y=yoyIdx(MA,i),f=(u,v)=>isNum(v)?(u==='%'?v.toFixed(2)+'%':v.toFixed(2)):'—';
  return`<table class="tbl s3 s3r"><thead><tr><th>Ratio</th><th>Numerator</th><th>Denominator</th><th class="num sel">${MA.labels[i]}<small>${fmtDate(MA.periods[i])}</small></th><th class="num">${y!=null?MA.labels[y]:'Previous year'}<small>${y!=null?fmtDate(MA.periods[y]):''}</small></th><th class="num">% Variance</th><th>Remarks</th></tr></thead><tbody>${s3Ratios(MA).map(r=>{
    const cv=r.f(i),pv=y!=null?r.f(y):null,va=growth(cv,pv),big=isNum(va)&&Math.abs(va)>25;
    return`<tr><td><b>${esc(r.n)}</b></td><td>${esc(r.num)}</td><td>${esc(r.den)}</td><td class="num"><b>${f(r.u,cv)}</b></td><td class="num">${f(r.u,pv)}</td>
      <td class="num ${big?'neg-t':''}">${isNum(va)?(va>=0?'+':'')+va.toFixed(1)+'%':'—'}</td>
      <td>${big?'<span class="flag">⚠️ Change exceeds 25% — reasons to be explained</span>':isNum(va)?'<span class="pos-t">✓ Within 25%</span>':''}${r.proxy?`<div class="note">ℹ️ ${esc(r.proxy)}</div>`:''}</td></tr>`}).join('')}</tbody></table>
    <div class="note" style="margin-top:8px">As required by Schedule III (Division II) “Additional Regulatory Information” — ratios for the current and previous year, with an explanation for any change of more than 25%. Averages use opening and closing balances; where the opening balance is unavailable the closing balance is used.</div>`}

/* ---------- rendering ---------- */
const S3T={bs:'Balance Sheet',pl:'Statement of Profit and Loss',cf:'Statement of Cash Flows',ratios:'Ratios (Schedule III)'};
function s3Cols(M,i){if(S.s3all)return M.periods.map((_,k)=>k).reverse();const y=yoyIdx(M,i);return y!=null?[i,y]:[i]}
function s3ColHead(M,k,kind){const d=fmtDate(M.periods[k]);return kind==='bs'?`As at ${d}`:`${M.freq==='quarterly'?'Quarter':'Year'} ended ${d}`}
function s3Amt(v,cur,eps){if(!isNum(v))return'—';if(eps)return v<0?`(${Math.abs(v).toFixed(2)})`:v.toFixed(2);
  const s=(Math.abs(v)/unitOf(cur).d).toLocaleString(loc(cur),{minimumFractionDigits:2,maximumFractionDigits:2});return v<0?`(${s})`:s}
function s3Visible(rows,cols){const vis=rows.map(r=>S.s3nil||r.c==='h'||r.c==='h2'||(r.v&&cols.some(k=>isNum(r.v[k]))));
  rows.forEach((r,j)=>{if(r.c!=='h3'||S.s3nil)return;let any=false;for(let q=j+1;q<rows.length&&(rows[q].d||0)>(r.d||0);q++)if(vis[q]){any=true;break}vis[j]=any});
  return vis}
function s3Table(rows,M,i,kind){const cols=s3Cols(M,i),vis=s3Visible(rows,cols),c=M.cur;
  if(!rows.some((r,j)=>vis[j]&&r.v))return`<div class="empty">📭 No ${S3T[kind].toLowerCase()} is published for this ${M.freq==='quarterly'?'quarter':'period'}.</div>`;
  return`<table class="tbl s3"><thead><tr><th>Particulars</th>${cols.map(k=>`<th class="num${k===i?' sel':''}">${s3ColHead(M,k,kind)}<small>${M.labels[k]}</small></th>`).join('')}</tr></thead>
  <tbody>${rows.map((r,j)=>!vis[j]?'':`<tr class="${r.c||''}"><td class="d${r.d||0}">${esc(r.lbl)}${r.bal?' <span class="bal" data-tip="Balancing figure — includes items not reported separately in the source data">*</span>':''}${r.note?` <span class="bal" data-tip="${esc(r.note)}">ⓘ</span>`:''}</td>${cols.map(k=>`<td class="num">${r.v?s3Amt(r.v[k],c,r.k==='eps'):r.c&&r.c[0]==='h'?'':'—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`}
function s3Notes(M,kind){const co=M.co,src=/^FILE-/.test(co.symbol)?'your uploaded file':co.symbol==='DEMO'?'the built-in fictional demo data':'standardised data published by Yahoo Finance';
  const s3=s3Build(M),i=selIndex(M),n=[],ind=((co.info||{}).industry||'')+' '+((co.info||{}).sector||'');
  if(/bank/i.test(ind))n.push('⚠️ <b>Banking companies</b> prepare financial statements in the format of the Third Schedule to the Banking Regulation Act, 1949 — not Schedule III. This Division II view is for comparison only.');
  else if(/insurance/i.test(ind))n.push('⚠️ <b>Insurance companies</b> follow the formats prescribed by IRDAI — not Schedule III. This Division II view is for comparison only.');
  else if(/credit services|financial services|capital markets|mortgage/i.test(ind))n.push('ℹ️ If this company is an <b>NBFC</b>, its statements follow <b>Division III</b> of Schedule III (Ind AS NBFCs), which classifies assets and liabilities as financial / non-financial instead of current / non-current.');
  n.push(kind==='cf'?'Prepared under Ind AS 7 <i>Statement of Cash Flows</i> (indirect method); Schedule III does not prescribe a cash-flow format.'
    :'Prepared in the format of <b>Division II of Schedule III</b> to the Companies Act, 2013 (companies required to comply with Ind AS), as amended by MCA notification dated 24 March 2021.');
  n.push(`Source: ${src}, re-arranged into Schedule III captions. <b>*</b> marks balancing figures that include items not reported separately; “—” means not reported in the source data. Figures in brackets are negative.`);
  if(kind==='bs'&&isNum(s3.diff[i])&&Math.abs(s3.diff[i])>Math.abs(s3.val.TA[i]||0)*0.005)n.push(`Total equity and liabilities differ from total assets by ${fmtAmt(s3.diff[i],M.cur)} in the source data.`);
  if(kind==='pl'&&s3.combined)n.push('“Cost of revenue (as reported)” combines the Schedule III captions for materials consumed, purchases of stock-in-trade and changes in inventories, plus other direct costs, because the source does not report them separately.');
  if(!/^FILE-|DEMO/.test(co.symbol))n.push('For statutory, audit or filing purposes, always refer to the company’s audited financial statements.');
  return`<ul class="s3-notes">${n.map(x=>`<li>${x}</li>`).join('')}</ul>`}
function s3Tools(extra=''){return`<div class="tbl-tools">${extra}<label class="chk"><input type="checkbox" data-role="s3all" ${S.s3all?'checked':''}> 🗓️ All periods</label>
  <label class="chk"><input type="checkbox" data-role="s3nil" ${S.s3nil?'checked':''}> 📋 Show all Schedule III captions</label><button class="btn sm" data-act="s3csv">⬇️ CSV</button><button class="btn sm" data-act="s3print">🖨️ Print</button></div>`}
function s3Statement(kind,M,i){const co=M.co,c=M.cur;
  if(kind==='ratios')return`<div class="s3-title"><b>${esc(co.name)}</b><div>Ratios — Additional Regulatory Information (Schedule III, Division II)</div></div><div class="tbl-wrap s3-wrap">${s3RatiosHTML(co)}</div>`;
  const when=kind==='bs'?`as at ${fmtDate(M.periods[i])}`:`for the ${M.freq==='quarterly'?'quarter':'year'} ended ${fmtDate(M.periods[i])}`;
  return`<div class="s3-title"><b>${esc(co.name)}</b><div>${S3T[kind]} ${when}</div><div class="note">(All amounts in ${SYM[c]||c+' '} ${unitOf(c).n}, unless otherwise stated)</div></div>
   <div class="tbl-wrap s3-wrap">${s3Table(s3Build(M)[kind],M,i,kind)}</div>${s3Notes(M,kind)}`}
function s3Card(kind){const c=ctx();if(!c||!c.M)return null;S.s3tab=kind;
  return card('s3-'+kind,`📑 ${S3T[kind]} — Schedule III (Division II, Ind AS)`,s3Tools()+s3Statement(kind,c.M,c.i),{span:12})}
function vS3(){const nd=needCo();if(nd)return nd;const{co,M,i,sub:subT}=ctx(),k=S.s3tab||'bs';
  const tabs=[['bs','🏦 Balance Sheet'],['pl','📈 Statement of Profit and Loss'],['cf','💵 Statement of Cash Flows'],['ratios','📐 Schedule III Ratios']];
  return vhead('📑 Schedule III — Division II (Ind AS)',subT)+`<div class="fchips">${tabs.map(([t,l])=>`<span class="chip btnchip${k===t?' acc':''}" data-act="s3tab" data-t="${t}">${l}</span>`).join('')}</div>`
   +`<div class="card-lite s3-card" id="s3-print">${k==='ratios'?'':s3Tools()}${s3Statement(k,M,i)}</div>`}
function s3CSV(){const c=ctx();if(!c||!c.M)return;const{co,M,i}=c,k=S.s3tab||'bs';
  if(k==='ratios'){const MA=getModel(co.symbol,'annual');if(!MA)return;const j=s3RatioIndex(MA),y=yoyIdx(MA,j);
    return downloadText(toCSV([['Ratio','Numerator','Denominator',MA.labels[j],y!=null?MA.labels[y]:'Previous','% Variance'],
      ...s3Ratios(MA).map(r=>{const a=r.f(j),b=y!=null?r.f(y):null,v=growth(a,b);return[r.n,r.num,r.den,isNum(a)?+a.toFixed(4):'',isNum(b)?+b.toFixed(4):'',isNum(v)?+v.toFixed(2):'']})]),
      `${shortName(co.name)}_Schedule_III_ratios.csv`)}
  const cols=s3Cols(M,i),rows=s3Build(M)[k],vis=s3Visible(rows,cols),d=unitOf(M.cur).d;
  downloadText(toCSV([[`Particulars (${M.cur} ${unitOf(M.cur).n})`,...cols.map(q=>s3ColHead(M,q,k))],
    ...rows.filter((r,j)=>vis[j]).map(r=>[r.lbl,...cols.map(q=>r.v&&isNum(r.v[q])?+(r.k==='eps'?r.v[q]:r.v[q]/d).toFixed(2):'')])]),
    `${shortName(co.name)}_${S3T[k].replace(/\W+/g,'_')}_Schedule_III.csv`)}

/* ======================= Broker & analyst views · Investor presentations & transcripts ======================= */
const EXTRA={};
const isListed=co=>!!co&&!/^(DEMO|FILE-)/.test(co.symbol);
async function loadExtra(kind,co){const key=kind+'|'+co.symbol,cur=EXTRA[key];if(cur&&(cur.state==='loading'||cur.state==='ok'))return;
  if(!SERVER){EXTRA[key]={state:'error',msg:'This section needs the Company Analyser server — it is not available in an offline snapshot.'};return}
  EXTRA[key]={state:'loading'};
  try{const url=kind==='analyst'?`/api/analyst?symbol=${encodeURIComponent(co.symbol)}`:`/api/filings?symbol=${encodeURIComponent(co.symbol)}&name=${encodeURIComponent(co.name||'')}`;
    const r=await fetch(url),d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Request failed');EXTRA[key]={state:'ok',d}}
  catch(e){EXTRA[key]={state:'error',msg:e.message}}
  if(S.active===co.symbol&&S.tab===(kind==='analyst'?'views':'ir'))render()}
function extraState(kind,co){const x=EXTRA[kind+'|'+co.symbol];if(!x){loadExtra(kind,co);return EXTRA[kind+'|'+co.symbol]||{state:'loading'}}return x}
const loadingCard=msg=>`<div class="card-lite loading" style="padding:36px;margin-bottom:16px"><div class="spinner"></div><p>${msg}</p></div>`;
const errorCard=(msg,kind)=>`<div class="card-lite empty" style="padding:28px;margin-bottom:16px">⚠️ ${esc(msg)}<br><br><button class="btn" data-act="extra-retry" data-k="${kind}">🔄 Try again</button></div>`;
const tile=(ic,label,val,sub,tone)=>`<div class="kpi"><div class="kpi-top"><span class="kpi-ico">${ic}</span><span>${esc(label)}</span></div><div class="kpi-val ${tone?tone+'-t':''}">${val}</div><div class="kpi-foot"><span class="vs">${sub||''}</span></div></div>`;
function researchLinks(co){const sym=co.symbol,base=sym.replace(/\.(NS|BO)$/i,''),q=encodeURIComponent,L=[];
  if(/\.(NS|BO)$/i.test(sym)){L.push(['📊','Screener.in — company page with concall transcripts & presentations',`https://www.screener.in/company/${q(base)}/consolidated/`]);
    L.push(['🏛️','NSE — quote & corporate announcements',`https://www.nseindia.com/get-quotes/equity?symbol=${q(base)}`])}
  L.push(['🗞️','Google News — brokerage target prices & recommendations',`https://news.google.com/search?q=${q(shortName(co.name)+' target price brokerage')}`]);
  L.push(['📈','Yahoo Finance — analyst estimates page',`https://finance.yahoo.com/quote/${q(sym)}/analysis/`]);
  return`<div class="linkgrid">${L.map(([i,t,u])=>`<a class="linkcard" href="${u}" target="_blank" rel="noopener noreferrer"><span class="li">${i}</span><span>${esc(t)}</span><span class="ext">↗</span></a>`).join('')}</div>
   <div class="note" style="margin-top:8px">Links open external websites in a new tab. Broker research reports belong to the brokers and are not copied into this app.</div>`}

/* ---------- analyst consensus ---------- */
const REC5=[['strongBuy','Strong Buy','var(--pos)'],['buy','Buy','#84cc16'],['hold','Hold','var(--warn)'],['sell','Sell','#f97316'],['strongSell','Strong Sell','var(--neg)']];
const PERIOD_L={'0m':'Now','-1m':'1 month ago','-2m':'2 months ago','-3m':'3 months ago'};
const EST_L={'0q':'Current quarter','+1q':'Next quarter','0y':'Current financial year','+1y':'Next financial year'};
function devsCard(d){return d.developments&&d.developments.length?card('v-devs','📰 Recent significant developments',`<ul class="insights">${d.developments.map(v=>`<li class="neu"><span class="ii">🗓️</span><span><b>${esc(v.date||'')}</b> — ${esc(v.headline)}</span></li>`).join('')}</ul><div class="note" style="margin-top:6px">Source: Yahoo Finance.</div>`,{span:12}):null}
function analystCards(co,d){
  const cur=d.currency||(co.info||{}).currency||'INR',sy=SYM[cur]||'',px=d.currentPrice,mean=d.recommendationMean;
  const tone=isNum(mean)?(mean<=2.5?'pos':mean<=3.5?'neu':'neg'):'';
  const up=v=>isNum(px)&&isNum(v)?(v/px-1)*100:null,upA=up(d.targetMean),pct=v=>isNum(v)?(v>=0?'+':'')+v.toFixed(1)+'%':'—';
  const k=[tile('🧭','Consensus rating',d.recommendationKey?esc(d.recommendationKey.replace('_',' ').toUpperCase()):'—',isNum(mean)?`Score ${mean.toFixed(2)} (1 = Strong Buy · 5 = Strong Sell)`:'',tone),
    tile('👥','Analysts covering',isNum(d.analysts)?Math.round(d.analysts):'—','Contributing price targets'),
    tile('🎯','Average target price',isNum(d.targetMean)?sy+fmtNum(d.targetMean,cur,2):'—',isNum(d.targetMedian)?`Median ${sy}${fmtNum(d.targetMedian,cur,2)}`:''),
    tile('📈','Upside to average target',pct(upA),isNum(px)?`From current price ${sy}${fmtNum(px,cur,2)}`:'',isNum(upA)?(upA>=0?'pos':'neg'):'')];
  const lo=d.targetLow,hi=d.targetHigh,rng=isNum(lo)&&isNum(hi)&&hi>lo,at=v=>rng&&isNum(v)?clamp((v-lo)/(hi-lo)*100,0,100):null;
  const scale=isNum(mean)?`<div class="scalebar"><i style="left:${clamp((mean-1)/4*100,0,100)}%"></i></div><div class="scalelab"><span>Strong Buy</span><span>Buy</span><span>Hold</span><span>Sell</span><span>Strong Sell</span></div>`:'';
  const range=rng?`<div class="rangebar"><span class="rb-fill"></span>${isNum(at(px))?`<i class="rb-now" style="left:${at(px)}%" data-tip="Current price ${sy}${fmtNum(px,cur,2)}"></i>`:''}${isNum(at(d.targetMean))?`<i class="rb-avg" style="left:${at(d.targetMean)}%" data-tip="Average target ${sy}${fmtNum(d.targetMean,cur,2)}"></i>`:''}</div>
    <div class="scalelab"><span>Low ${sy}${fmtNum(lo,cur,0)} (${pct(up(lo))})</span><span>High ${sy}${fmtNum(hi,cur,0)} (${pct(up(hi))})</span></div>
    <div class="note">⚫ current price · 🔷 average target${isNum(px)&&px<lo?' · price is below the lowest target':isNum(px)&&px>hi?' · price is above the highest target':''}</div>`:'<div class="note">Price-target range not published.</div>';
  const cards=[card('v-cons','🧭 Consensus & price targets',`<div class="note" style="margin-bottom:6px">Average recommendation</div>${scale}<div class="note" style="margin:14px 0 6px">Analyst price-target range</div>${range}`,{span:6})];
  const tr=(d.trend||[]).slice().sort((a,b)=>(parseInt(a.period)||0)-(parseInt(b.period)||0));
  if(tr.length){cards.push(chartCard('v-dist','📊 Analyst recommendations — last 4 months',{type:'bar',stacked:true,labels:tr.map(t=>PERIOD_L[t.period]||t.period),
      series:REC5.map(([key,name,color])=>({name,color,data:tr.map(t=>t[key]||0)})),fmt:v=>Math.round(v)+'',tf:v=>Math.round(v)+' analysts'},{span:6}))}
  if((d.estimates||[]).length){cards.push(card('v-est','🔮 Consensus estimates',`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Period</th><th class="num">EPS estimate</th><th class="num">Low – High</th><th class="num">Analysts</th><th class="num">EPS growth</th><th class="num">Revenue estimate</th><th class="num">Revenue growth</th></tr></thead><tbody>
    ${d.estimates.map(e=>`<tr><td><b>${EST_L[e.period]||esc(e.period)}</b><small class="note"> ${e.endDate?'· ends '+fmtDate(e.endDate):''}</small></td><td class="num"><b>${isNum(e.epsAvg)?sy+e.epsAvg.toFixed(2):'—'}</b></td>
      <td class="num">${isNum(e.epsLow)&&isNum(e.epsHigh)?`${sy}${e.epsLow.toFixed(2)} – ${sy}${e.epsHigh.toFixed(2)}`:'—'}</td><td class="num">${isNum(e.epsAnalysts)?Math.round(e.epsAnalysts):'—'}</td>
      <td class="num ${isNum(e.epsGrowth)?(e.epsGrowth>=0?'pos-t':'neg-t'):''}">${isNum(e.epsGrowth)?pct(e.epsGrowth*100):'—'}</td><td class="num">${isNum(e.revAvg)?fmtAmt(e.revAvg,cur):'—'}</td>
      <td class="num ${isNum(e.revGrowth)?(e.revGrowth>=0?'pos-t':'neg-t'):''}">${isNum(e.revGrowth)?pct(e.revGrowth*100):'—'}</td></tr>`).join('')}</tbody></table></div>`,{span:12}))}
  cards.push(card('v-changes','🏦 Rating changes by broking firms',(d.changes||[]).length?`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Firm</th><th>Action</th><th>Rating</th><th class="num">Price target</th></tr></thead><tbody>
    ${d.changes.map(c=>{const act={up:'⬆️ Upgrade',down:'⬇️ Downgrade',init:'🆕 Initiated',main:'↔️ Maintained',reit:'🔁 Reiterated'}[c.action]||esc(c.action||'');
      return`<tr><td>${esc(c.date||'')}</td><td><b>${esc(c.firm||'')}</b></td><td>${act}</td><td>${c.from&&c.from!==c.to?esc(c.from)+' → ':''}<b>${esc(c.to||'')}</b></td>
      <td class="num">${isNum(c.target)?sy+fmtNum(c.target,cur,2):'—'}${isNum(c.priorTarget)&&isNum(c.target)&&c.priorTarget!==c.target?` <small class="note">(was ${sy}${fmtNum(c.priorTarget,cur,2)})</small>`:''}</td></tr>`}).join('')}</tbody></table></div>`
    :`<div class="note">Yahoo Finance does not publish firm-by-firm rating changes for this stock (common for Indian listings). Record the broker views you receive in the tracker below, or use the research links.</div>`,{span:12}));
  return{kpis:`<div class="kpis">${k.join('')}</div>`,cards}}

/* ---------- my broker views tracker (saved in this browser) ---------- */
const BV_KEY=sym=>'ca-bviews-'+sym;
const RATINGS=['Strong Buy','Buy','Accumulate','Add','Outperform','Hold','Neutral','Reduce','Underperform','Sell'];
const ratingTone=r=>/buy|accumulate|add|outperform/i.test(r)?'good':/sell|reduce|underperform/i.test(r)?'weak':'ok';
function bvTracker(co,px,cur){const list=ls.get(BV_KEY(co.symbol),[]).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')),sy=SYM[cur]||'';
  const up=t=>isNum(px)&&isNum(t)?(t/px-1)*100:null,tg=list.map(v=>v.target).filter(isNum),avgT=tg.length?tg.reduce((a,b)=>a+b)/tg.length:null,cnt={good:0,ok:0,weak:0};
  list.forEach(v=>cnt[ratingTone(v.rating)]++);const pct=v=>(v>=0?'+':'')+v.toFixed(1)+'%';
  return`<div class="bv-form"><input data-bv="broker" placeholder="Broker / analyst — e.g. Motilal Oswal" maxlength="60">
    <select data-bv="rating">${RATINGS.map(r=>`<option>${r}</option>`).join('')}</select>
    <input data-bv="target" type="number" step="any" min="0" placeholder="Target price${sy?' ('+sy+')':''}">
    <input data-bv="date" type="date" value="${new Date().toISOString().slice(0,10)}">
    <input data-bv="link" type="url" placeholder="Link to report / article (optional)" maxlength="400">
    <button class="btn primary sm" data-act="bv-add">➕ Add view</button></div>
   ${list.length?`<div class="chips" style="margin:12px 0 10px"><span class="chip">🧾 ${list.length} view${list.length>1?'s':''}</span><span class="st good">🟢 ${cnt.good} buy-side</span><span class="st ok">🟡 ${cnt.ok} hold / neutral</span><span class="st weak">🔴 ${cnt.weak} sell-side</span>
     ${isNum(avgT)?`<span class="chip acc">🎯 Average target ${sy}${fmtNum(avgT,cur,0)}${isNum(up(avgT))?` (${pct(up(avgT))} vs current price)`:''}</span>`:''}</div>
   <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Broker / analyst</th><th>Rating</th><th class="num">Target</th><th class="num">Upside</th><th>Source</th><th></th></tr></thead><tbody>
   ${list.map(v=>{const u=up(v.target);return`<tr><td>${esc(v.date||'')}</td><td><b>${esc(v.broker)}</b></td><td><span class="st ${ratingTone(v.rating)}">${esc(v.rating)}</span></td>
     <td class="num">${isNum(v.target)?sy+fmtNum(v.target,cur,2):'—'}</td><td class="num ${isNum(u)?(u>=0?'pos-t':'neg-t'):''}">${isNum(u)?pct(u):'—'}</td>
     <td>${v.link?`<a href="${esc(v.link)}" target="_blank" rel="noopener noreferrer">Open ↗</a>`:''}</td><td><button class="ib" data-act="bv-del" data-id="${esc(v.id)}" title="Delete">🗑️</button></td></tr>`}).join('')}</tbody></table></div>
   <div class="tbl-tools" style="margin-top:8px"><button class="btn sm" data-act="bv-csv">⬇️ Download CSV</button><span class="note">Saved in this browser only — not shared with anyone.</span></div>`
   :'<div class="note" style="margin-top:10px">Record the views in broker reports you receive (broker, rating, target price). The app works out the upside from today’s price and summarises them. Saved in this browser only.</div>'}`}
function bvAdd(btn){const c=btn.closest('.card'),co=activeCo();if(!c||!co)return;const g=k=>c.querySelector(`[data-bv="${k}"]`).value.trim();
  const broker=g('broker'),target=parseFloat(g('target')),link=g('link');
  if(!broker)return toast('✍️ Enter the broker or analyst name','warn');
  if(link&&!/^https?:\/\//i.test(link))return toast('🔗 The link must start with http:// or https://','warn');
  const list=ls.get(BV_KEY(co.symbol),[]);list.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),broker:broker.slice(0,60),rating:g('rating'),
    target:isFinite(target)&&target>0?target:null,date:g('date')||new Date().toISOString().slice(0,10),link:link.slice(0,400)});
  ls.set(BV_KEY(co.symbol),list);render();toast('✅ View added','ok',1500)}
function bvCSV(){const co=activeCo();if(!co)return;const list=ls.get(BV_KEY(co.symbol),[]);
  downloadText(toCSV([['Date','Broker / analyst','Rating','Target price','Source'],...list.map(v=>[v.date,v.broker,v.rating,v.target??'',v.link||''])]),`${shortName(co.name)}_broker_views.csv`)}

function vViews(){const nd=needCo();if(nd)return nd;const{co,M}=ctx(),info=co.info||{};
  const head=vhead('🗣️ Broker & Analyst Views',`${esc(co.name)} · consensus rating, price targets, estimates and broker views`);
  if(!isListed(co))return head+`<div class="card-lite empty" style="padding:30px">🗣️ Analyst coverage is available for listed companies — search for one by name or ticker.</div>`;
  const x=extraState('analyst',co);let top='',cards=[];
  if(x.state==='loading')top=loadingCard('Fetching analyst consensus…');
  else if(x.state==='error')top=errorCard(x.msg,'analyst');
  else if(!x.d.available){top=`<div class="card-lite" style="padding:16px 18px;margin-bottom:16px">ℹ️ ${esc(x.d.reason||'No analyst coverage is available.')}</div>`}
  else{const a=analystCards(co,x.d);top=a.kpis;cards=a.cards}
  const d=x.d||{},px=d.currentPrice||info.currentPrice||info.regularMarketPrice,cur=d.currency||info.currency||M.cur;
  cards.push(card('v-tracker','📝 My broker views tracker',bvTracker(co,px,cur),{span:12}));
  if(x.state==='ok')cards.push(devsCard(d));
  cards.push(card('v-links','🔗 Read the research',researchLinks(co),{span:12}));
  return head+top+grid('views',cards)+`<p class="note">⚠️ Analyst ratings and targets are third-party opinions compiled by Yahoo Finance — not recommendations by this app, and not investment advice.</p>`}

/* ---------- investor presentations, transcripts & other filings (BSE) ---------- */
const IRKIND={presentation:['🎞️','Investor presentation'],transcript:['📝','Earnings call transcript'],recording:['🎧','Call recording'],meet:['👥','Analyst / investor meet'],results:['📊','Financial results'],annual:['📘','Annual report']};
const IRF=[['key','⭐ Key documents'],['presentation','🎞️ Presentations'],['transcript','📝 Transcripts'],['recording','🎧 Call recordings'],['meet','👥 Analyst meets'],['results','📊 Results'],['annual','📘 Annual reports'],['all','🗂️ All']];
const IRKEY=['presentation','transcript','recording'];
function irListHTML(d){const f=S.irFilter||'key',q=(S.irQ||'').toLowerCase().trim();
  const items=d.items.filter(i=>f==='all'||(f==='key'?IRKEY.includes(i.kind):i.kind===f)).filter(i=>!q||i.title.toLowerCase().includes(q));
  if(!items.length)return'<div class="empty">📭 No documents match this filter in the last two years.</div>';
  let last='',rows='';
  items.forEach(i=>{const m=pmeta(i.date,true),grp=`${m.qL} · ${['Apr–Jun','Jul–Sep','Oct–Dec','Jan–Mar'][m.q-1]}`;
    if(grp!==last){rows+=`<tr class="grp"><td colspan="4">${grp}</td></tr>`;last=grp}
    const[ic,lab]=IRKIND[i.kind]||['📄',i.kind];
    rows+=`<tr><td>${fmtDate(i.date)}</td><td><span class="chip">${ic} ${lab}</span></td><td style="white-space:normal">${esc(i.title)}</td><td>${i.url?`<a class="btn sm" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">📄 Open PDF</a>`:''}</td></tr>`});
  return`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Type</th><th>Document</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`}
function vIR(){const nd=needCo();if(nd)return nd;const{co}=ctx();
  const head=vhead('🎤 Investor Presentations & Transcripts',`${esc(co.name)} · official filings on BSE · last two years`);
  if(!isListed(co)||!/\.(NS|BO)$/i.test(co.symbol))return head+`<div class="card-lite empty" style="padding:30px">🎤 Presentations and earnings-call transcripts are available for companies listed on NSE / BSE.</div>`+(isListed(co)?grid('ir',[card('ir-links','🔗 Research links',researchLinks(co),{span:12})]):'');
  const x=extraState('filings',co);
  if(x.state==='loading')return head+loadingCard('Fetching presentations and transcripts from BSE…');
  if(x.state==='error')return head+errorCard(x.msg,'filings')+grid('ir',[card('ir-links','🔗 Find them elsewhere',researchLinks(co),{span:12})]);
  const d=x.d;if(!d.available)return head+`<div class="card-lite empty" style="padding:30px">ℹ️ ${esc(d.reason||'No filings found.')}</div>`+grid('ir',[card('ir-links','🔗 Research links',researchLinks(co),{span:12})]);
  const hl=IRKEY.map(k=>{const it=d.items.find(i=>i.kind===k),[ic,lab]=IRKIND[k];
    return it&&it.url?`<a class="card-lite ir-hl" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer"><span class="ir-ic">${ic}</span><span><span class="note">Latest ${lab.toLowerCase()}</span><b>${esc(it.title)}</b><span class="note">${fmtDate(it.date)} · Open PDF ↗</span></span></a>`
      :`<div class="card-lite ir-hl off"><span class="ir-ic">${ic}</span><span><span class="note">Latest ${lab.toLowerCase()}</span><b>None filed in the last two years</b></span></div>`}).join('');
  const cnt=k=>k==='all'?d.items.length:k==='key'?d.items.filter(i=>IRKEY.includes(i.kind)).length:d.items.filter(i=>i.kind===k).length;
  const chips=`<div class="fchips">${IRF.map(([k,l])=>`<span class="chip btnchip${(S.irFilter||'key')===k?' acc':''}" data-act="irf" data-f="${k}">${l} <b>${cnt(k)}</b></span>`).join('')}
    <div class="search sm" style="margin-left:auto"><span>🔍</span><input data-role="ir-q" value="${esc(S.irQ||'')}" placeholder="Search documents…"></div></div>`;
  return head+`<div class="ir-hls">${hl}</div>`+chips+`<div class="card-lite" style="padding:14px;margin-bottom:16px"><div id="ir-list">${irListHTML(d)}</div>
    <div class="note" style="margin-top:8px">Source: corporate announcements filed with BSE (BSE scrip code ${esc(d.bseCode)}). Documents open from bseindia.com.</div></div>`
    +grid('ir',[card('ir-links','🔗 More research links',researchLinks(co),{span:12})])}

/* ---------- Guide ---------- */
function vGuide(){return vhead('❓ Guide & Ratio Glossary','Everything you need to get started')+`<div class="grid guide">
  ${[['🚀 Getting started',`<ol><li>Type a <b>company name</b> (e.g. <i>Infosys</i>) or <b>ticker</b> in the search bar and press <b>Analyse</b>.</li><li>Choose <b>Annual / Quarterly</b>, then the <b>Year</b> and <b>Quarter</b> in the filter bar.</li><li>Move through the sections on the left: Overview → P&amp;L → Balance Sheet → Cash Flow → Ratios.</li><li>Add peers in <b>⚖️ Peer Comparison</b>.</li><li>Tap <b>🔗 Share</b> to send a link to what you are viewing, or <b>📱 Phone</b> to open it on your mobile.</li></ol>`],
    ['🔎 Ticker formats',`<p>🇮🇳 NSE: <code>RELIANCE.NS</code>, <code>TCS.NS</code><br>🇮🇳 BSE: <code>500325.BO</code> or <code>RELIANCE.BO</code><br>🇺🇸 US: <code>AAPL</code>, <code>MSFT</code><br>Names work too — “HDFC Bank”, “Tata Steel”.</p><p>ℹ️ Some companies (e.g. Infosys on Yahoo) report financials in USD — the currency is shown on every page and converted automatically in comparisons.</p>`],
    ['📑 Schedule III &amp; Ind AS',`<ul><li>The <b>📑 Schedule III</b> page presents the Balance Sheet, Statement of Profit and Loss and Statement of Cash Flows in the format of <b>Division II of Schedule III</b> to the Companies Act, 2013 (Ind AS companies), as amended in March 2021.</li><li>The Cash Flow Statement follows <b>Ind AS 7</b> (indirect method).</li><li><b>Schedule III ratios</b> (current, debt-equity, DSCR, ROE, turnover ratios, net profit, ROCE, ROI) are shown with the previous year and flag changes above 25%.</li><li>Items marked <b>*</b> are balancing figures; “—” means the source does not report the item separately. Upload your own Schedule III statements (see the template in Smart Upload) for exact line items.</li></ul>`],
    ['🗣️ Analyst views &amp; 🎤 filings',`<ul><li><b>Broker &amp; Analyst Views</b> shows the analyst consensus, price-target range and upside, rating trend, EPS / revenue estimates and — where published — rating changes by named broking firms (source: Yahoo Finance).</li><li>Use the <b>My broker views tracker</b> to record views from broker reports you receive; it calculates upside and summarises them.</li><li><b>Presentations &amp; Transcripts</b> lists investor presentations, earnings-call transcripts, call recordings, analyst meets, results and annual reports filed on <b>BSE</b>, with direct PDF links.</li></ul>`],
    ['🖱️ Dashboard tips',`<ul><li><b>Drag</b> any card by its ⠿ handle to rearrange; ↔️ resizes it. Layout is remembered.</li><li>Click <b>legend items</b> to hide/show series; 📊📈🏔️ switch chart type.</li><li>⛶ expands a chart, ⬇️ saves it as PNG.</li><li>Press <code>/</code> to jump to search. Hover anything for details.</li><li>🖨️ Print → “Save as PDF” for reports.</li></ul>`],
    ['📱 Phone &amp; sharing',`<ul><li>Open the same address on any phone, tablet or computer. Charts respond to touch — tap for details, pinch to zoom.</li><li>Install it: <b>Share → Add to Home Screen</b> (iPhone) or <b>⋮ → Install app</b> (Android / Chrome).</li><li><b>🔗 Share</b> sends a link that opens the same companies and page.</li><li><b>Smart Upload</b> reads your files inside the browser — they are never sent to the server.</li><li>Source: Yahoo Finance. Figures may differ slightly from filed reports; verify before relying on them.</li></ul>`]].map(([t,b])=>`<div class="card span-6"><div class="card-body" style="padding:16px"><h3>${t}</h3>${b}</div></div>`).join('')}</div>
  <div class="card-lite" style="padding:16px"><div class="tbl-tools"><h3 style="margin:0">🧮 Ratio Glossary</h3><div class="search sm" style="margin-left:auto"><span>🔍</span><input data-role="gloss-q" placeholder="Search glossary…"></div></div>
  <div class="tbl-wrap" style="max-height:none"><table class="tbl gloss" id="gloss"><thead><tr><th>Group</th><th>Ratio</th><th>Formula</th><th>What it tells you</th><th>Rule-of-thumb benchmark</th></tr></thead><tbody>${RATIOS.map(d=>`<tr><td>${GROUPS.find(g=>g[0]===d.g)[1]} ${d.g}</td><td><b>${d.n}</b></td><td>${d.f}</td><td>${d.tip}</td><td>${benchText(d)}</td></tr>`).join('')}</tbody></table></div>
  <p class="note">⚠️ Benchmarks are generic rules of thumb; healthy levels vary by industry (e.g. banks, IT services and manufacturers look very different). Always compare with sector peers. This tool is for analysis and education, not investment advice.</p></div>`}
/* ======================= 5. App shell, events, startup ======================= */
const TABS=[['overview','🏠','Overview'],['pl','📈','Profit & Loss'],['bs','🏦','Balance Sheet'],['cf','💵','Cash Flow'],['s3','📑','Schedule III'],['ratios','🧮','Ratio Analysis'],['compare','⚖️','Peer Comparison'],['views','🗣️','Broker & Analyst Views'],['ir','🎤','Presentations & Transcripts'],['smart','📤','Smart Upload'],['guide','❓','Guide & Glossary']];
const VIEWS={overview:vOverview,pl:vPL,bs:vBS,cf:vCF,s3:vS3,ratios:vRatios,compare:vCompare,views:vViews,ir:vIR,smart:vSmart,guide:vGuide};
function toast(msg,tone='info',ms=3500){const t=document.createElement('div');t.className='toast '+tone;t.innerHTML=msg;$('#toasts').appendChild(t);setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),350)},ms)}
function render(){
  CHARTS.clear();const v=$('#view');
  v.innerHTML=S.loading&&S.tab!=='compare'?loadingView():VIEWS[S.tab]();
  v.classList.remove('enter');void v.offsetWidth;v.classList.add('enter');
  mountCharts(v);$$('.grid[data-grid]',v).forEach(enableDnD);animateCounts(v);
  if($('#q2'))attachSuggest($('#q2'),$('#suggest2'),q=>loadCompany(q));
  if($('#peerQ'))attachSuggest($('#peerQ'),$('#peerSuggest'),q=>loadCompany(q,{activate:false}));
  const dz=$('#dropzone');if(dz){['dragenter','dragover'].forEach(e=>dz.addEventListener(e,x=>{x.preventDefault();dz.classList.add('over')}));['dragleave','drop'].forEach(e=>dz.addEventListener(e,x=>{x.preventDefault();dz.classList.remove('over')}));
    dz.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)handleFile(f)});$('#fileIn').addEventListener('change',e=>{const f=e.target.files[0];if(f)handleFile(f);e.target.value=''})}
  updateChrome()}
function updateChrome(){
  $('#nav').innerHTML=TABS.map(([k,ic,l])=>`<button data-tab="${k}" class="${S.tab===k?'on':''}"><span class="ico">${ic}</span>${l}</button>`).join('');
  const syms=Object.keys(S.companies);
  $('#loadedList').innerHTML=syms.length?syms.map(s=>`<div class="loaded${s===S.active?' on':''}" data-switch="${esc(s)}" title="${esc(S.companies[s].name)}"><span>${s===S.active?'📌':'🏢'}</span><span class="ln">${esc(shortName(S.companies[s].name))}</span><button class="x" data-remove="${esc(s)}" title="Remove">✕</button></div>`).join(''):'<div class="note">Nothing loaded yet — search for a company above 🔍</div>';
  $$('#themeSwitch button').forEach(b=>b.classList.toggle('on',b.dataset.theme===document.documentElement.dataset.theme));
  $$('#freqSeg button').forEach(b=>b.classList.toggle('on',b.dataset.f===S.freq));
  $('#unitSel').value=S.unit;
  const M=S.active&&getModel(S.active),ys=$('#yearSel'),qs=$('#qSel');
  if(!M){ys.innerHTML='<option>—</option>';qs.innerHTML='<option>—</option>';ys.disabled=qs.disabled=true}
  else{const i=selIndex(M),cm=M.metas[i],fys=[...new Set(M.metas.map(x=>x.fy))].sort((a,b)=>b-a);ys.disabled=false;
    ys.innerHTML=fys.map(f=>`<option value="${f}" ${f===cm.fy?'selected':''}>${M.indian?`FY ${f-1}-${String(f).slice(-2)}`:`FY ${f}`}</option>`).join('');
    if(S.freq==='quarterly'){qs.disabled=false;qs.innerHTML=M.metas.map((x,k)=>({x,k})).filter(o=>o.x.fy===cm.fy).map(o=>`<option value="${o.k}" ${o.k===i?'selected':''}>Q${o.x.q}${M.indian?` (${qMonths(o.x.q)})`:''}</option>`).join('')}
    else{qs.disabled=true;qs.innerHTML='<option>Full year</option>'}}
  const co=activeCo();$('#refreshBtn').disabled=!(SERVER&&S.online&&co&&!/^(DEMO|FILE-)/.test(co.symbol));
  $('#statusPill').textContent=SERVER?'🟢 Online':'🔴 Server unreachable';
  document.title=co?`${shortName(co.name)} · Company Analyser`:'Company Analyser'}
function applyTheme(t){document.documentElement.setAttribute('data-theme',t);ls.set('ca-theme',t);$$('#themeSwitch button').forEach(b=>b.classList.toggle('on',b.dataset.theme===t));if(typeof Charts!=='undefined')Charts.refresh()}
const saveLoaded=()=>{ls.set('ca-loaded',Object.keys(S.companies).filter(s=>!s.startsWith('FILE-')));ls.set('ca-active',S.active)};
function addCompany(d,activate=true){S.companies[d.symbol]=d;S.cmpOff.delete(d.symbol);clearModels(d.symbol);if(activate||!S.active){S.active=d.symbol;S.selDate=null;if(['smart','guide','compare'].includes(S.tab)&&activate)S.tab='overview'}saveLoaded();render()}
function removeCompany(s){delete S.companies[s];clearModels(s);if(S.active===s){S.active=Object.keys(S.companies)[0]||null;S.selDate=null}saveLoaded();render()}
async function loadCompany(q,{refresh=false,activate=true,quiet=false,cached=false}={}){
  q=String(q||'').trim();if(!q)return toast('✍️ Type a company name or ticker first','warn');
  if(q.toUpperCase()==='DEMO'){addCompany(makeDemo(),activate);if(!quiet)toast('🎯 Demo company loaded — all figures are fictional','ok');return}
  if(!SERVER)return toast('📴 Offline — start Company Analyser (<b>python company_analyser.py</b>) to download new companies.','warn',6000);
  if(!quiet&&activate){S.loading=q;render()}else if(!quiet)toast(`⬇️ Adding ${esc(q)}…`,'info',2000);
  try{const r=await fetch(`/api/company?q=${encodeURIComponent(q)}${refresh?'&refresh=1':''}${cached?'&cached=1':''}`),d=await r.json();if(!r.ok||d.error)throw new Error(d.error||'Download failed');
    S.loading=null;addCompany(d,activate);
    if(!quiet){toast(d.warning?'⚠️ '+esc(d.warning):`✅ <b>${esc(d.name)}</b> loaded${d.fromCache?' (from cache)':''}`,d.warning?'warn':'ok');if(d.note)toast('🔎 '+esc(d.note),'info',5000)}
    return d}
  catch(e){S.loading=null;if(!quiet){toast('❌ '+esc(e.message),'err',7000);render()}}}
function attachSuggest(input,box,onPick){
  let items=[],idx=-1,timer,seq=0;
  const show=()=>{box.innerHTML=items.map((it,k)=>`<div class="sg${k===idx?' on':''}" data-k="${k}"><span class="sg-sym">${esc(it.symbol)}</span><span class="sg-name">${esc(it.name)}</span><span class="sg-ex">${esc(it.exchange||'')}</span></div>`).join('');box.classList.toggle('open',items.length>0)};
  const close=()=>{items=[];idx=-1;show()};
  input.addEventListener('input',()=>{const q=input.value.trim(),nq=norm(q);idx=-1;if(!nq){close();return}
    items=[{symbol:'DEMO',name:'Demo Industries (fictional sample)',exchange:'Demo'},...(S.cached||[]).map(c=>({...c,exchange:'🗄️ Saved'})),...LOCAL.map(c=>({...c,exchange:c.symbol.includes('.')?'NSE':'US'}))]
      .filter(c=>norm(c.name).includes(nq)||norm(c.symbol).startsWith(nq)).filter((c,k,a)=>a.findIndex(x=>x.symbol===c.symbol)===k).slice(0,7);show();
    clearTimeout(timer);if(SERVER&&S.online&&q.length>=2)timer=setTimeout(async()=>{const my=++seq;try{const r=await(await fetch('/api/search?q='+encodeURIComponent(q))).json();if(my!==seq||!Array.isArray(r))return;const have=new Set(items.map(x=>x.symbol));items=[...items,...r.filter(x=>!have.has(x.symbol))].slice(0,11);show()}catch(e){}},320)});
  input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){idx=Math.min(idx+1,items.length-1);show();e.preventDefault()}else if(e.key==='ArrowUp'){idx=Math.max(idx-1,-1);show();e.preventDefault()}
    else if(e.key==='Enter'){e.preventDefault();const it=idx>=0?items[idx]:null;close();onPick(it?it.symbol:input.value.trim());input.value=''}else if(e.key==='Escape')close()});
  box.addEventListener('mousedown',e=>{const el=e.target.closest('.sg');if(!el)return;e.preventDefault();const it=items[+el.dataset.k];close();input.value='';onPick(it.symbol)});
  input.addEventListener('blur',()=>setTimeout(close,150))}
function openModal(title,spec){$('#modalTitle').textContent=title;$('#modalBody').innerHTML='<div class="chart" id="modalChart"></div>';$('#modal').classList.add('open');requestAnimationFrame(()=>Charts.draw($('#modalChart'),Object.assign({},spec,{height:Math.min(innerHeight*0.68,580)})))}
const closeModal=()=>$('#modal').classList.remove('open');
function loadScript(src,globalName){return new Promise((res,rej)=>{if(window[globalName])return res(window[globalName]);
  const s=document.createElement('script');s.src=src;s.onload=()=>res(window[globalName]);s.onerror=()=>rej(new Error('Could not load '+src));document.head.appendChild(s)})}
const isLocalHost=()=>/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
function publicBase(){return isLocalHost()&&S.lan&&S.lan[0]?S.lan[0]:location.origin+'/'}
function shareURL(){const syms=Object.keys(S.companies).filter(s=>!/^(DEMO|FILE-)/.test(s)),p=new URLSearchParams();
  if(syms.length)p.set('load',(syms.includes(S.active)?[S.active,...syms.filter(s=>s!==S.active)]:syms).join(','));
  else if(S.active==='DEMO')p.set('load','DEMO');
  if(S.tab!=='overview')p.set('tab',S.tab);if(S.freq!=='annual')p.set('freq',S.freq);
  const h=p.toString();return publicBase()+(h?'#'+h:'')}
async function shareLink(){const url=shareURL(),co=activeCo();
  if(navigator.share){try{await navigator.share({title:'Company Analyser',text:co?`${shortName(co.name)} — Company Analyser`:'Company Analyser',url});return}catch(e){if(e.name==='AbortError')return}}
  try{await navigator.clipboard.writeText(url);toast('🔗 Link copied — paste it in WhatsApp, email or any browser','ok',4000)}catch(e){openPhone()}}
async function openPhone(){const url=shareURL();let svg='';
  try{const qr=await loadScript('/vendor/qrcode.min.js','qrcode'),q=qr(0,'M');q.addData(url);q.make();svg=q.createSvgTag({cellSize:6,margin:2,scalable:true})}catch(e){}
  const lanOnly=isLocalHost()||/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  $('#modalTitle').textContent='📱 Open on your phone';
  $('#modalBody').innerHTML=`<div class="qr">${svg||''}<p>Scan with your phone camera, or open this address:</p><code class="qr-url">${esc(url)}</code>
    ${isLocalHost()&&!(S.lan&&S.lan.length)?'<p class="note">⚠️ Could not detect this computer’s Wi-Fi address.</p>':''}
    ${lanOnly?'<p class="note">📶 Your phone must be connected to the <b>same Wi-Fi</b> as this computer.</p>':''}
    <button class="btn" id="copyUrl">📋 Copy link</button></div>`;
  $('#modal').classList.add('open');
  $('#copyUrl').onclick=async()=>{try{await navigator.clipboard.writeText(url);toast('📋 Link copied','ok',1500)}catch(e){}}}

/* ---------- global events ---------- */
$('#nav').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(!b)return;S.tab=b.dataset.tab;render();$('#sidebar').classList.remove('open');$('#scrim').classList.remove('open');scrollTo({top:0,behavior:'smooth'})});
$('#loadedList').addEventListener('click',e=>{const x=e.target.closest('[data-remove]');if(x){e.stopPropagation();removeCompany(x.dataset.remove);return}const s=e.target.closest('[data-switch]');if(s){S.active=s.dataset.switch;S.selDate=null;if(['smart','guide'].includes(S.tab))S.tab='overview';saveLoaded();render()}});
$('#themeSwitch').addEventListener('click',e=>{const b=e.target.closest('[data-theme]');if(b)applyTheme(b.dataset.theme)});
$('#freqSeg').addEventListener('click',e=>{const b=e.target.closest('[data-f]');if(b&&b.dataset.f!==S.freq){S.freq=b.dataset.f;render()}});
$('#yearSel').addEventListener('change',e=>{const M=getModel(S.active);if(!M)return;const fy=+e.target.value,ks=M.metas.map((x,k)=>x.fy===fy?k:-1).filter(k=>k>=0);S.selDate=M.periods[lastOf(ks)];render()});
$('#qSel').addEventListener('change',e=>{const M=getModel(S.active);if(M){S.selDate=M.periods[+e.target.value];render()}});
$('#unitSel').addEventListener('change',e=>{S.unit=e.target.value;ls.set('ca-unit',S.unit);render()});
$('#refreshBtn').addEventListener('click',()=>{if(S.active)loadCompany(S.active,{refresh:true})});
$('#exportBtn').addEventListener('click',shareLink);
$('#phoneBtn').addEventListener('click',openPhone);
$('#printBtn').addEventListener('click',()=>print());
$('#goBtn').addEventListener('click',()=>{const q=$('#q').value.trim();$('#q').value='';loadCompany(q)});
$('#menuBtn').addEventListener('click',()=>{$('#sidebar').classList.toggle('open');$('#scrim').classList.toggle('open')});
$('#scrim').addEventListener('click',()=>{$('#sidebar').classList.remove('open');$('#scrim').classList.remove('open')});
$('#modalClose').addEventListener('click',closeModal);$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if(e.key==='/'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)){e.preventDefault();$('#q').focus()}});
attachSuggest($('#q'),$('#suggest'),q=>loadCompany(q));
const tip=$('#tip');let tipEl=null;
function moveTip(e){const t=e.target.closest&&e.target.closest('[data-tip]');if(!t){if(tipEl){tip.classList.remove('show');tipEl=null}return}
  if(t!==tipEl){tip.innerHTML=t.getAttribute('data-tip');tipEl=t;tip.classList.add('show')}
  const r=tip.getBoundingClientRect();let x=e.clientX+14,y=e.clientY+14;if(x+r.width>innerWidth-8)x=e.clientX-r.width-14;if(y+r.height>innerHeight-8)y=e.clientY-r.height-14;tip.style.transform=`translate(${Math.max(4,x)}px,${Math.max(4,y)}px)`}
document.addEventListener('mousemove',moveTip);
document.addEventListener('touchstart',e=>{const t=e.target.closest&&e.target.closest('[data-tip]');if(!t)return;const p=e.touches[0];moveTip({target:t,clientX:p.clientX,clientY:p.clientY});clearTimeout(window._tt);window._tt=setTimeout(()=>{tip.classList.remove('show');tipEl=null},2500)},{passive:true});document.addEventListener('scroll',()=>{tip.classList.remove('show');tipEl=null},true);
document.addEventListener('click',e=>{const lg=e.target.closest('[data-lg]');if(!lg)return;const el=lg.closest('.chart'),sp=el&&el._spec;if(!sp)return;sp.hidden=sp.hidden||new Set();const n=lg.dataset.lg;sp.hidden.has(n)?sp.hidden.delete(n):sp.hidden.add(n);Charts.draw(el,sp,false)});
const V=$('#view');
V.addEventListener('click',e=>{const a=e.target.closest('[data-act]');if(!a)return;const act=a.dataset.act,cd=a.closest('.card'),ch=cd&&cd.querySelector('[data-chart]'),sp=ch&&ch._spec;
  if(a.tagName==='A')e.preventDefault();
  switch(act){
    case'type':sp.type=a.dataset.t;Charts.draw(ch,sp);$$('[data-act="type"]',cd).forEach(b=>b.classList.toggle('on',b===a));break;
    case'max':openModal(cd.querySelector('h3').textContent,sp);break;
    case'png':Charts.png(ch,cd.querySelector('h3').textContent);break;
    case'span':cycleSpan(cd);break;
    case'reset-layout':$$('.grid[data-grid]',V).forEach(g=>ls.del('ca-lay-'+g.dataset.grid));render();toast('↺ Layout reset','ok',1500);break;
    case'load':loadCompany(a.dataset.q);break;
    case'load-q2':{const q=$('#q2').value;loadCompany(q);break}
    case'add-peer':loadCompany(a.dataset.q,{activate:false});break;
    case'tab':S.tab=a.dataset.tab;render();break;
    case'freq':S.freq=a.dataset.f;render();break;
    case'tbl-sort':{const t=S.tbl[a.dataset.st],c=a.dataset.c==='name'||a.dataset.c==='chg'?a.dataset.c:+a.dataset.c;t.sort=t.sort&&t.sort.c===c?(t.sort.d===-1?{c,d:1}:null):{c,d:c==='name'?1:-1};$('#tblw-'+a.dataset.st).innerHTML=stmtTable(a.dataset.st);break}
    case'tbl-csv':{const d=stmtRows(a.dataset.st);if(d)downloadText(toCSV([['Line item',...d.b.periods],...d.rows.map(r=>[r.name,...r.vals])]),`${shortName(activeCo().name)}_${a.dataset.st}_${S.freq}.csv`);break}
    case'ratio-pick':{S.ratioSel=a.dataset.k;$$('.rcard',V).forEach(c=>c.classList.toggle('active',c.dataset.k===S.ratioSel));const el=$('[data-chart="r-trend"]',V),M=getModel(S.active);if(el&&M){const sp2=ratioTrendSpec(M,selIndex(M));CHARTS.set('r-trend',sp2);Charts.draw(el,sp2);$('[data-role="ratio-sel"]',V).value=S.ratioSel;el.closest('.card').scrollIntoView({behavior:'smooth',block:'center'})}break}
    case'rgroup':S.ratioGroup=a.dataset.g;$$('[data-act="rgroup"]',V).forEach(c=>c.classList.toggle('acc',c===a));$('#ratio-cards').innerHTML=ratioCardsHTML();break;
    case'ratio-csv':{const M=getModel(S.active);downloadText(toCSV([['Group','Ratio','Formula',...M.labels],...RATIOS.map(d=>[d.g,d.n,d.f,...M.r[d.k].map(v=>isNum(v)?+v.toFixed(4):'')])]),`${shortName(M.co.name)}_ratios_${S.freq}.csv`);break}
    case'cmp-toggle':{const s=a.dataset.s;S.cmpOff.has(s)?S.cmpOff.delete(s):S.cmpOff.add(s);render();break}
    case'ds-sample':ingest('Sample Sales Data',sampleSales());break;
    case'fin-template':finTemplate();toast('⬇️ Template downloaded — fill in your numbers and drop it back here','ok',4000);break;
    case'ds-clear':S.ds=null;render();break;
    case'ds-reset':S.ds.filters={};S.ds.q='';S.ds.page=0;render();break;
    case'ds-sort':{const j=+a.dataset.j,s=S.ds.sort;S.ds.sort=s&&s.j===j?(s.d===-1?{j,d:1}:null):{j,d:-1};$('#ds-table').innerHTML=dsTable(dsFiltered(S.ds));break}
    case'ds-page':S.ds.page=Math.max(0,S.ds.page+ +a.dataset.d);$('#ds-table').innerHTML=dsTable(dsFiltered(S.ds));break;
    case'extra-retry':{const co=activeCo();if(co){delete EXTRA[a.dataset.k+'|'+co.symbol];render()}break}
    case'irf':S.irFilter=a.dataset.f;render();break;
    case'bv-add':bvAdd(a);break;
    case'bv-del':{const co=activeCo();if(co){ls.set(BV_KEY(co.symbol),ls.get(BV_KEY(co.symbol),[]).filter(v=>v.id!==a.dataset.id));render()}break}
    case'bv-csv':bvCSV();break;
    case's3tab':S.s3tab=a.dataset.t;render();break;
    case's3csv':{const cd2=a.closest('.card');if(cd2&&cd2.dataset.id&&cd2.dataset.id.startsWith('s3-'))S.s3tab=cd2.dataset.id.slice(3);s3CSV();break}
    case's3print':{const el=a.closest('.card,.card-lite');document.body.classList.add('printing');el.classList.add('print-target');print();setTimeout(()=>{document.body.classList.remove('printing');el.classList.remove('print-target')},400);break}
    case'ds-csv':{const ds=S.ds;downloadText(toCSV([ds.cols.map(c=>c.name),...dsFiltered(ds).map(r=>r.map(v=>v??''))]),ds.name.replace(/\W+/g,'_')+'_filtered.csv');break}
  }});
let inTimer;
V.addEventListener('input',e=>{const el=e.target,role=el.dataset.role;if(!role)return;clearTimeout(inTimer);
  inTimer=setTimeout(()=>{
    if(role==='tbl-q'){S.tbl[el.dataset.st].q=el.value;$('#tblw-'+el.dataset.st).innerHTML=stmtTable(el.dataset.st)}
    else if(role==='ratio-q'){S.ratioQ=el.value;$('#ratio-cards').innerHTML=ratioCardsHTML()}
    else if(role==='ir-q'){S.irQ=el.value;const co=activeCo(),x=co&&EXTRA['filings|'+co.symbol];if(x&&x.state==='ok')$('#ir-list').innerHTML=irListHTML(x.d)}
    else if(role==='ds-q'){S.ds.q=el.value;S.ds.page=0;refreshDs()}
    else if(role==='gloss-q'){const q=el.value.toLowerCase();$$('#gloss tbody tr').forEach(tr=>tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none')}},180)});
V.addEventListener('change',e=>{const el=e.target,role=el.dataset.role;if(!role)return;
  if(role==='s3all'){S.s3all=el.checked;render();return}
  if(role==='s3nil'){S.s3nil=el.checked;render();return}
  if(role==='tbl-key'){S.tbl[el.dataset.st].key=el.checked;$('#tblw-'+el.dataset.st).innerHTML=stmtTable(el.dataset.st)}
  else if(role==='ratio-sel'){S.ratioSel=el.value;const M=getModel(S.active),ch=$('[data-chart="r-trend"]',V),sp=ratioTrendSpec(M,selIndex(M));CHARTS.set('r-trend',sp);Charts.draw(ch,sp);$$('.rcard',V).forEach(c=>c.classList.toggle('active',c.dataset.k===S.ratioSel))}
  else if(role==='ds-filter'){S.ds.filters[el.dataset.j]=el.value;S.ds.page=0;refreshDs()}
  else if(role==='up-cur')S.upCur=el.value;else if(role==='up-unit')S.upUnit=el.value});
function refreshDs(){const o=$('#ds-out');if(!o)return;o.innerHTML=dsOut();mountCharts(o,false);$$('.grid[data-grid]',o).forEach(enableDnD);animateCounts(o)}

/* ---------- deep links: #load=TCS.NS,INFY.NS&tab=ratios&freq=quarterly&theme=dark ---------- */
async function applyHash(){const hp=new URLSearchParams(location.hash.slice(1));if(![...hp.keys()].length)return;
    if(hp.get('still'))document.documentElement.classList.add('no-motion');
    if(hp.get('theme'))applyTheme(hp.get('theme'));
    if(hp.get('freq'))S.freq=hp.get('freq');
    const syms=(hp.get('load')||'').split(',').filter(Boolean);
    for(const s of syms)await loadCompany(s,{quiet:true,cached:true,activate:false});
    if(syms.length){const f=Object.keys(S.companies).find(k=>k.toUpperCase()===syms[0].toUpperCase()||k==='DEMO');if(f){S.active=f;S.selDate=null}}
    if(hp.get('sample'))ingest('Sample Sales Data',sampleSales());
    if(hp.get('tab'))S.tab=hp.get('tab');
    render();
    if(hp.get('scroll'))setTimeout(()=>{const el=$(hp.get('scroll'));if(el)el.scrollIntoView({block:'start'})},50)}
/* ---------- startup ---------- */
(async function init(){
  applyTheme(document.documentElement.getAttribute('data-theme')||'light');
  let emb=null;try{emb=JSON.parse($('#embedded-data').textContent)}catch(e){}
  if(emb&&emb.companies){Object.assign(S.companies,emb.companies);S.active=emb.active||Object.keys(emb.companies)[0]||null;Object.assign(S.fx,emb.fx||{});S.snapshot=emb.createdAt}
  if(location.protocol.startsWith('http')){try{const st=await(await fetch('/api/status')).json();SERVER=true;S.online=!!st.online;S.cached=st.cached||[];S.lan=st.lan||[]}catch(e){}}
  render();
  if(!emb){const saved=ls.get('ca-loaded',[]),act=ls.get('ca-active',null);
    const jobs=saved.map(s=>s==='DEMO'?Promise.resolve(S.companies.DEMO=makeDemo()):SERVER?fetch(`/api/company?q=${encodeURIComponent(s)}&cached=1`).then(r=>r.json()).then(d=>{if(d&&d.symbol&&!d.error)S.companies[d.symbol]=d}).catch(()=>{}):null).filter(Boolean);
    if(jobs.length){await Promise.all(jobs);S.active=S.companies[act]?act:Object.keys(S.companies)[0]||null;render()}}
  await applyHash();
  addEventListener('hashchange',()=>applyHash());
})();
