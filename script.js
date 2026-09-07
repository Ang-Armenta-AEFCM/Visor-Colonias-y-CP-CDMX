"use strict";
const $=id=>document.getElementById(id);
const clean=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
const fmt=n=>Number(n||0).toLocaleString('es-MX');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
let meta,schools=[],visible=[],inmuebles=[],visibleInm=[],programMap=new Map(),schoolByCct=new Map(),currentInm=null;
let alcGeo,cpGeo=null,colGeo=null,alcLabels=[],activeTerritoryType=null;
let mapReady=false,coreReady=false,territoryReady=false,controlsBound=false;
const idle=fn=>('requestIdleCallback' in window?requestIdleCallback(fn,{timeout:1200}):setTimeout(fn,60));
const jsonFetch=url=>fetch(url,{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error(`${url}: ${r.status}`);return r.json()});
const lightStyle={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},layers:[{id:'bg',type:'background',paint:{'background-color':'#eef3f6'}},{id:'osm',type:'raster',source:'osm',paint:{'raster-opacity':.95}}]};
const darkStyle={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},layers:[{id:'bg',type:'background',paint:{'background-color':'#17222b'}},{id:'osm',type:'raster',source:'osm',paint:{'raster-opacity':.55,'raster-brightness-max':.45,'raster-saturation':-1,'raster-contrast':.25}}]};
if(typeof maplibregl==='undefined'){document.getElementById('loading').textContent='No se pudo cargar el motor del mapa. Recarga la página.';throw new Error('MapLibre GL no disponible');}
const map=new maplibregl.Map({container:'map',style:lightStyle,center:[-99.13,19.35],zoom:9.65,pitch:0,bearing:0,antialias:true,maxZoom:19,maxPitch:85});
map.addControl(new maplibregl.NavigationControl({showCompass:true}),'top-right');

map.once('load',()=>{mapReady=true;tryInitCoreMap()});

(async function boot(){
  try{
    const [m,alcs,official]=await Promise.all([
      jsonFetch('data/manifest.json'),
      jsonFetch('data/alcaldias.json'),
      jsonFetch('data/inmuebles_oficiales.json')
    ]);
    meta=m;programMap=new Map(m.programas.map(p=>[p.id,p]));inmuebles=official;
    schools=(await Promise.all(m.partes.map(f=>jsonFetch('data/'+f)))).flat();schools.forEach((s,i)=>s._idx=i);
    schoolByCct=new Map(schools.map(s=>[s.cct,s]));
    alcGeo=decorateAlcaldias(alcs);
    buildControls();if(!controlsBound){bind();controlsBound=true}
    coreReady=true;tryInitCoreMap();
    // El mapa ya puede usarse. Las geometrías territoriales pesadas cargan después, sin bloquear la apertura.
    idle(loadTerritoryData);
  }catch(e){$('loading').textContent='Error al cargar los datos';console.error(e)}
})();

function tryInitCoreMap(){
  if(!mapReady||!coreReady)return;
  installMapLayers();render();fitGeo(alcGeo,{pitch:0});
  $('loading').style.display='none';
  idle(buildSearchLists);
}
async function loadTerritoryData(){
  try{
    $('cpStatusSummary').textContent='Preparando códigos postales…';
    $('colStatusSummary').textContent='Preparando colonias…';
    [cpGeo,colGeo]=await Promise.all([jsonFetch('data/codigos_postales.geojson'),jsonFetch('data/colonias_asentamientos.geojson')]);
    territoryReady=true;
    enableTerritoryControls(true);
    refreshTerritoryMenus('cp');refreshTerritoryMenus('colonia');
    if(mapReady)installTerritoryMapLayers();
  }catch(e){
    $('cpStatusSummary').textContent='No se pudieron cargar los CP.';
    $('colStatusSummary').textContent='No se pudieron cargar las colonias.';console.error(e)
  }
}
function enableTerritoryControls(enabled){
  ['fCPStatus','fColStatus','fCP','fColonia','searchCP','searchColonia','downloadCP','downloadCol','showCP','showColonias'].forEach(id=>{if($(id))$(id).disabled=!enabled});
}
function buildSearchLists(){
  if(!schools.length)return;
  $('cctList').innerHTML=schools.map(x=>`<option value="${esc(x.cct)}">`).join('');
  $('nameList').innerHTML=[...new Set(schools.map(x=>x.nombre).filter(Boolean))].sort().map(x=>`<option value="${esc(x)}">`).join('');
}

function selectedAlcaldias(){return new Set([...document.querySelectorAll('#alcList input:checked')].map(x=>x.value))}
function featureInSelectedAlcs(f){const a=selectedAlcaldias();if(!a.size)return true;const ac=new Set([...a].map(clean));return ac.has(clean(f.properties.alcaldia))}
function territoryFeatures(type){const g=type==='cp'?cpGeo:colGeo;if(!g)return [];const mode=$(type==='cp'?'fCPStatus':'fColStatus').value;return g.features.filter(f=>featureInSelectedAlcs(f)&&(mode==='without'?Number(f.properties.inmuebles||0)===0:Number(f.properties.inmuebles||0)>0))}
function territoryAllInScope(type){const g=type==='cp'?cpGeo:colGeo;return g?g.features.filter(featureInSelectedAlcs):[]}

function decorateAlcaldias(g){
  const byInm=new Map();for(const i of inmuebles){const k=clean(i.alcaldia);byInm.set(k,(byInm.get(k)||0)+1)}
  const bySchool=new Map();for(const s of schools){const k=clean(s.alcaldia);if(!bySchool.has(k))bySchool.set(k,{cct:new Set(),pub:0,pri:0,niv:new Map()});const o=bySchool.get(k);o.cct.add(s.cct);if(s.sostenimiento==='Público')o.pub++;else if(s.sostenimiento==='Privada')o.pri++;o.niv.set(s.nivel,(o.niv.get(s.nivel)||0)+1)}
  for(const f of g.features){const k=clean(f.properties.NOMGEO),o=bySchool.get(k)||{cct:new Set(),pub:0,pri:0,niv:new Map()};f.properties.inmuebles=byInm.get(k)||0;f.properties.cct=o.cct.size;f.properties.publicas=o.pub;f.properties.privadas=o.pri;f.properties.topniv=[...o.niv].sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>`${x[0]} ${x[1]}`).join(' · ')}return g
}

function installMapLayers(){
  if(!map.getSource('alcaldias')){
    map.addSource('alcaldias',{type:'geojson',data:alcGeo});
    map.addSource('alcaldias-3d',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addSource('schools',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'alc-base',type:'fill',source:'alcaldias',paint:{'fill-color':'#7997ad','fill-opacity':.08}});
    map.addLayer({id:'alc-line',type:'line',source:'alcaldias',paint:{'line-color':'#536c7d','line-width':1.35}});
    map.addLayer({id:'alc-extrude',type:'fill-extrusion',source:'alcaldias-3d',paint:{'fill-extrusion-color':['get','towerColor'],'fill-extrusion-height':['get','towerHeight'],'fill-extrusion-base':0,'fill-extrusion-opacity':.96,'fill-extrusion-vertical-gradient':true}});
    map.addLayer({id:'schools',type:'circle',source:'schools',paint:{'circle-radius':4.5,'circle-color':['get','color'],'circle-stroke-width':1,'circle-stroke-color':'#fff','circle-opacity':.88}});
    map.on('click','schools',e=>{const id=e.features?.[0]?.properties?.idx,x=schools[Number(id)];if(x)showDetail(x)});
    map.on('mouseenter','schools',()=>map.getCanvas().style.cursor='pointer');map.on('mouseleave','schools',()=>map.getCanvas().style.cursor='');
  }
  if(territoryReady)installTerritoryMapLayers();
}
function installTerritoryMapLayers(){
  if(!territoryReady||!mapReady||map.getSource('cp'))return;
  map.addSource('cp',{type:'geojson',data:cpGeo});
  map.addSource('colonias',{type:'geojson',data:colGeo});
  map.addSource('cp-3d',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addSource('colonias-3d',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'cp-extrude',type:'fill-extrusion',source:'cp-3d',layout:{visibility:'none'},paint:{'fill-extrusion-color':['get','towerColor'],'fill-extrusion-height':['get','towerHeight'],'fill-extrusion-base':0,'fill-extrusion-opacity':.94,'fill-extrusion-vertical-gradient':true}});
  map.addLayer({id:'col-extrude',type:'fill-extrusion',source:'colonias-3d',layout:{visibility:'none'},paint:{'fill-extrusion-color':['get','towerColor'],'fill-extrusion-height':['get','towerHeight'],'fill-extrusion-base':0,'fill-extrusion-opacity':.94,'fill-extrusion-vertical-gradient':true}});
  map.on('click','cp-extrude',e=>{const v=e.features?.[0]?.properties?.cp;if(v){$('fCP').value=v;render();activateTerritory3D('cp',v)}});
  map.on('click','col-extrude',e=>{const v=e.features?.[0]?.properties?.cvegeo;if(v){$('fColonia').value=v;render();activateTerritory3D('colonia',v)}});
  updateSelectedProperties();showTerritoryLayers();
}

function buildControls(){
  const alcs=[...new Set(schools.map(x=>x.alcaldia).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  $('alcList').innerHTML=alcs.map(a=>`<label><input type="checkbox" value="${esc(a)}"> ${esc(a)}</label>`).join('');
  fill($('fNivel'),[...new Set(schools.map(x=>x.nivel).filter(Boolean))].sort());
  $('programFilters').innerHTML=meta.programas.map(p=>`<label><input type="checkbox" value="${esc(p.id)}"><span class="program-dot" style="background:${esc(p.color)}"></span>${esc(p.label)}</label>`).join('');
  enableTerritoryControls(false);
  $('cpStatusSummary').textContent='Cargando en segundo plano…';$('colStatusSummary').textContent='Cargando en segundo plano…';
}
function fill(sel,arr){arr.forEach(v=>sel.add(new Option(v,v)))}

function refreshTerritoryMenus(type){
  if(!territoryReady)return;
  const isCP=type==='cp',arr=territoryFeatures(type),select=$(isCP?'fCP':'fColonia'),old=select.value;
  if(isCP){
    const vals=arr.map(f=>String(f.properties.cp)).sort();
    select.innerHTML='<option value="">Todos los de la lista</option>'+vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(vals.includes(old))select.value=old;
    $('cpSearchList').innerHTML=vals.map(v=>`<option value="${esc(v)}">`).join('');
    $('cpStatusSummary').textContent=`${fmt(vals.length)} CP ${$('fCPStatus').value==='without'?'sin':'con'} inmuebles${selectedAlcaldias().size?' en las alcaldías seleccionadas':''}`;
    $('cpMenuList').innerHTML=arr.map(f=>`<button type="button" class="territory-list-row${String(f.properties.cp)===select.value?' active':''}" data-value="${esc(f.properties.cp)}"><span>CP ${esc(f.properties.cp)}</span><small>${fmt(f.properties.inmuebles)} inm.</small></button>`).join('')||'<p class="hint">Sin CP en esta combinación.</p>';
    $('cpMenuList').querySelectorAll('.territory-list-row').forEach(b=>b.onclick=()=>{select.value=b.dataset.value;render();activateTerritory3D('cp',b.dataset.value);refreshTerritoryMenus('cp')});
  }else{
    const vals=arr.map(f=>({id:String(f.properties.cvegeo),label:`${f.properties.nom_asen} · ${f.properties.tipo||'Asentamiento'} · CP ${f.properties.cp||'—'}`,n:f.properties.inmuebles})).sort((a,b)=>a.label.localeCompare(b.label,'es'));
    select.innerHTML='<option value="">Todas las de la lista</option>'+vals.map(o=>`<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');if(vals.some(x=>x.id===old))select.value=old;
    $('colSearchList').innerHTML=vals.map(o=>`<option value="${esc(o.label)}">`).join('');
    $('colStatusSummary').textContent=`${fmt(vals.length)} colonias/asentamientos ${$('fColStatus').value==='without'?'sin':'con'} inmuebles${selectedAlcaldias().size?' en las alcaldías seleccionadas':''}`;
    $('colMenuList').innerHTML=vals.map(o=>`<button type="button" class="territory-list-row${o.id===select.value?' active':''}" data-value="${esc(o.id)}"><span>${esc(o.label)}</span><small>${fmt(o.n)} inm.</small></button>`).join('')||'<p class="hint">Sin colonias en esta combinación.</p>';
    $('colMenuList').querySelectorAll('.territory-list-row').forEach(b=>b.onclick=()=>{select.value=b.dataset.value;render();activateTerritory3D('colonia',b.dataset.value);refreshTerritoryMenus('colonia')});
  }
}

function bind(){
  ['fNivel','colorMode'].forEach(id=>$(id).addEventListener('change',render));
  $('alcList').onchange=()=>{refreshTerritoryMenus('cp');refreshTerritoryMenus('colonia');render();activeTerritoryType?activateTerritoryPartition(activeTerritoryType):activateAlcaldias3D()};
  $('allAlc').onclick=()=>{document.querySelectorAll('#alcList input').forEach(x=>x.checked=true);refreshTerritoryMenus('cp');refreshTerritoryMenus('colonia');render();activeTerritoryType?activateTerritoryPartition(activeTerritoryType):activateAlcaldias3D()};
  $('noneAlc').onclick=()=>{document.querySelectorAll('#alcList input').forEach(x=>x.checked=false);refreshTerritoryMenus('cp');refreshTerritoryMenus('colonia');render();activeTerritoryType?activateTerritoryPartition(activeTerritoryType):activateAlcaldias3D()};
  $('fCPStatus').onchange=()=>{activeTerritoryType='cp';$('fCP').value='';refreshTerritoryMenus('cp');render();activateTerritoryPartition('cp')};
  $('fColStatus').onchange=()=>{activeTerritoryType='colonia';$('fColonia').value='';refreshTerritoryMenus('colonia');render();activateTerritoryPartition('colonia')};
  $('fCP').onchange=()=>{activeTerritoryType='cp';render();$('fCP').value?activateTerritory3D('cp',$('fCP').value):activateTerritoryPartition('cp');refreshTerritoryMenus('cp')};
  $('fColonia').onchange=()=>{activeTerritoryType='colonia';render();$('fColonia').value?activateTerritory3D('colonia',$('fColonia').value):activateTerritoryPartition('colonia');refreshTerritoryMenus('colonia')};
  document.querySelectorAll('input[name=soste]').forEach(x=>x.onchange=render);$('programFilters').onchange=render;
  $('showCP').onchange=()=>{activeTerritoryType=$('showCP').checked?'cp':activeTerritoryType;showTerritoryLayers()};$('showColonias').onchange=()=>{activeTerritoryType=$('showColonias').checked?'colonia':activeTerritoryType;showTerritoryLayers()};$('showSchools').onchange=render;
  $('allProg').onclick=()=>{document.querySelectorAll('#programFilters input').forEach(x=>x.checked=true);render()};$('noneProg').onclick=()=>{document.querySelectorAll('#programFilters input').forEach(x=>x.checked=false);render()};
  $('clearFilters').onclick=resetFilters;$('statsReset').onclick=resetFilters;
  $('searchCCT').onchange=searchZoom;$('searchCCT').onkeydown=e=>{if(e.key==='Enter')searchZoom()};$('searchName').onchange=searchZoom;$('searchName').onkeydown=e=>{if(e.key==='Enter')searchZoom()};
  $('searchCP').onchange=searchTerritory;$('searchCP').onkeydown=e=>{if(e.key==='Enter')searchTerritory()};$('searchColonia').onchange=searchTerritory;$('searchColonia').onkeydown=e=>{if(e.key==='Enter')searchTerritory()};
  $('downloadCP').onclick=()=>downloadTerritoryList('cp');$('downloadCol').onclick=()=>downloadTerritoryList('colonia');
  $('closeDetail').onclick=()=>$('detail').classList.remove('open');$('fitAll').onclick=()=>{clearAlcLabels();activeTerritoryType=null;showTerritoryLayers();fitGeo(alcGeo,{pitch:0,bearing:0})};
  $('fullscreen').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();$('menuBtn').onclick=()=>$('sidebar').classList.toggle('open');
  document.querySelectorAll('.navtab').forEach(b=>b.onclick=()=>switchView(b.dataset.view));$('closeModal').onclick=()=>$('inmModal').classList.remove('open');$('inmModal').onclick=e=>{if(e.target===$('inmModal'))$('inmModal').classList.remove('open')};
  $('goMapInm').onclick=()=>{if(currentInm&&Number.isFinite(currentInm.lon)&&Number.isFinite(currentInm.lat)){switchView('mapView');map.easeTo({center:[currentInm.lon,currentInm.lat],zoom:17,pitch:45,duration:900});$('inmModal').classList.remove('open')}};
  $('basemap').onchange=()=>switchBasemap($('basemap').value);
  $('inmuebleList').onclick=e=>{const r=e.target.closest('.inm-row');if(r)showInmueble(r.dataset.key)};
}

function resetFilters(){
  document.querySelectorAll('#alcList input').forEach(x=>x.checked=false);['fNivel','fCP','fColonia','searchCCT','searchName','searchCP','searchColonia'].forEach(id=>$(id).value='');$('fCPStatus').value='with';$('fColStatus').value='with';
  document.querySelectorAll('input[name=soste]').forEach(x=>x.checked=true);document.querySelectorAll('#programFilters input').forEach(x=>x.checked=false);$('showCP').checked=false;$('showColonias').checked=false;activeTerritoryType=null;clearAlcLabels();refreshTerritoryMenus('cp');refreshTerritoryMenus('colonia');render();showTerritoryLayers();fitGeo(alcGeo,{pitch:0,bearing:0});
}
function switchBasemap(mode){const center=map.getCenter(),zoom=map.getZoom(),pitch=map.getPitch(),bearing=map.getBearing();map.setStyle(mode==='dark'?darkStyle:lightStyle);$('map').classList.toggle('dark-map',mode==='dark');map.once('styledata',()=>{installMapLayers();render();showTerritoryLayers();map.jumpTo({center,zoom,pitch,bearing})})}
function showTerritoryLayers(){if(map.getLayer('alc-extrude'))map.setLayoutProperty('alc-extrude','visibility',activeTerritoryType?'none':'visible');if(map.getLayer('cp-extrude'))map.setLayoutProperty('cp-extrude','visibility',(activeTerritoryType==='cp'||$('showCP').checked)?'visible':'none');if(map.getLayer('col-extrude'))map.setLayoutProperty('col-extrude','visibility',(activeTerritoryType==='colonia'||$('showColonias').checked)?'visible':'none')}

function state(){return {alcaldias:selectedAlcaldias(),nivel:$('fNivel').value,cp:$('fCP').value,col:$('fColonia').value,soste:new Set([...document.querySelectorAll('input[name=soste]:checked')].map(x=>x.value)),progs:new Set([...document.querySelectorAll('#programFilters input:checked')].map(x=>x.value))}}
function filtered(){const s=state();return schools.filter(x=>{if(s.alcaldias.size&&!s.alcaldias.has(x.alcaldia))return false;if(s.nivel&&x.nivel!==s.nivel)return false;if(s.cp&&x.cp!==s.cp)return false;if(s.col&&x.cvegeo_asentamiento!==s.col)return false;if(!s.soste.has(x.sostenimiento))return false;if(s.progs.size&&!x.programas.some(p=>s.progs.has(p)))return false;return true})}
function filterOfficialInmuebles(){
  const s=state(),visibleCcts=new Set(visible.map(x=>x.cct)),attributeFilter=!!s.nivel||s.progs.size>0||s.soste.size<2,alcClean=new Set([...s.alcaldias].map(clean));
  return inmuebles.filter(i=>{if(alcClean.size&&!alcClean.has(clean(i.alcaldia)))return false;if(s.cp&&String(i.cp)!==String(s.cp))return false;if(s.col&&String(i.col)!==String(s.col))return false;if(attributeFilter&&!i.ccts.some(c=>visibleCcts.has(c)))return false;return true})
}
function render(){if(!meta)return;visible=filtered();visibleInm=filterOfficialInmuebles();updateKPIs();renderSchools();renderLegend();updateSelectedProperties();if($('statsView').classList.contains('active'))renderStats();showTerritoryLayers()}
function updateKPIs(){const s=state();$('kTotal').textContent=fmt(new Set(visible.map(x=>x.cct)).size);$('kInm').textContent=fmt(visibleInm.length);$('kPub').textContent=fmt(visible.filter(x=>x.sostenimiento==='Público').length);$('kPri').textContent=fmt(visible.filter(x=>x.sostenimiento==='Privada').length);$('kProg').textContent=fmt(visible.filter(x=>x.programas.length).length);const parts=[];if(s.alcaldias.size)parts.push(`${s.alcaldias.size} alcaldía${s.alcaldias.size>1?'s':''}`);if(s.cp)parts.push('CP '+s.cp);if(s.col&&colGeo){const f=colGeo.features.find(y=>String(y.properties.cvegeo)===String(s.col));if(f)parts.push(f.properties.nom_asen)}if(s.nivel)parts.push(s.nivel);$('scopeNote').textContent=parts.length?'Conteo actual: '+parts.join(' · '):`Base completa: ${fmt(meta.total_cct_unicos)} CCT únicos y ${fmt(inmuebles.length)} inmuebles oficiales.`}
function renderSchools(){if(!map.getSource('schools'))return;const mode=$('colorMode').value,features=$('showSchools').checked?visible.filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)).map(x=>({type:'Feature',geometry:{type:'Point',coordinates:[x.lon,x.lat]},properties:{idx:x._idx,color:colorFor(x,mode)}})):[];map.getSource('schools').setData({type:'FeatureCollection',features})}
const levelColors=['#2f6da5','#b05b6f','#638b48','#a06d2c','#7257a3','#2e8a89','#a45030','#55707f','#91648a','#5a7b57'];
function colorFor(x,mode){if(mode==='sostenimiento')return x.sostenimiento==='Privada'?'#8b5fa5':'#1f78a8';if(mode==='programa')return x.programas.length?'#c65e2e':'#748594';const levels=meta.niveles||[];return levelColors[Math.max(0,levels.indexOf(x.nivel))%levelColors.length]}
function renderLegend(){let mode=$('colorMode').value,h='<b>Leyenda</b>';if(activeTerritoryType){h+=`<div><i class="swatch" style="background:#5b8fb4"></i>Con inmuebles</div><div><i class="swatch" style="background:#cf7777"></i>Sin inmuebles</div>`}else if(mode==='sostenimiento')h+='<div><i class="swatch" style="background:#1f78a8"></i>Pública</div><div><i class="swatch" style="background:#8b5fa5"></i>Privada</div>';else if(mode==='programa')h+='<div><i class="swatch" style="background:#c65e2e"></i>Con programa</div><div><i class="swatch" style="background:#748594"></i>Sin programa</div>';else h+=(meta.niveles||[]).map((n,i)=>`<div><i class="swatch" style="background:${levelColors[i%levelColors.length]}"></i>${esc(n)}</div>`).join('');$('legend').innerHTML=h}

function cloneTowerFeature(f,props){
  return {type:'Feature',geometry:f.geometry,properties:{...f.properties,...props}};
}
function updateSelectedProperties(){
  const s=state(),alcCount=s.alcaldias.size,cpMode=$('fCPStatus').value,colMode=$('fColStatus').value;
  const selectedNames=new Set([...s.alcaldias].map(clean));

  // Alcaldías: la fuente 3D contiene únicamente las alcaldías marcadas.
  const alc3d=[];
  for(const f of alcGeo.features){
    const sel=selectedNames.has(clean(f.properties.NOMGEO));
    f.properties.selected=sel?1:0;
    if(sel){
      alc3d.push(cloneTowerFeature(f,{
        towerHeight: alcCount===1 ? 9000 : 5600,
        towerColor: alcCount===1 ? '#c9535b' : '#cf6a70'
      }));
    }
  }

  // CP: cuando se activa el modo CP se levantan TODOS los CP en el ámbito seleccionado,
  // con distinto color/altura según tengan o no inmuebles. El CP puntual seleccionado sobresale.
  const cp3d=[];
  if(activeTerritoryType==='cp')for(const f of (cpGeo?.features||[])){
    const scope=featureInSelectedAlcs(f),has=Number(f.properties.inmuebles||0)>0;
    const status=scope&&((cpMode==='with'&&has)||(cpMode==='without'&&!has));
    const selected=!!s.cp&&String(f.properties.cp)===String(s.cp);
    f.properties.inScope=scope?1:0;f.properties.hasInm=has?1:0;f.properties.statusSelected=status?1:0;f.properties.selected=selected?1:0;
    if(activeTerritoryType==='cp'&&scope){
      cp3d.push(cloneTowerFeature(f,{
        towerHeight:selected?5200:(status?3000:650),
        towerColor:selected?'#153f60':(has?'#4f8db7':'#d27070')
      }));
    }
  }

  // Colonias: misma lógica que CP.
  const col3d=[];
  if(activeTerritoryType==='colonia')for(const f of (colGeo?.features||[])){
    const scope=featureInSelectedAlcs(f),has=Number(f.properties.inmuebles||0)>0;
    const status=scope&&((colMode==='with'&&has)||(colMode==='without'&&!has));
    const selected=!!s.col&&String(f.properties.cvegeo)===String(s.col);
    f.properties.inScope=scope?1:0;f.properties.hasInm=has?1:0;f.properties.statusSelected=status?1:0;f.properties.selected=selected?1:0;
    if(activeTerritoryType==='colonia'&&scope){
      col3d.push(cloneTowerFeature(f,{
        towerHeight:selected?4400:(status?2400:500),
        towerColor:selected?'#5c3f70':(has?'#866aa0':'#d37a7a')
      }));
    }
  }

  if(map.getSource('alcaldias'))map.getSource('alcaldias').setData(alcGeo);
  if(map.getSource('alcaldias-3d'))map.getSource('alcaldias-3d').setData({type:'FeatureCollection',features:alc3d});
  if(map.getSource('cp-3d'))map.getSource('cp-3d').setData({type:'FeatureCollection',features:cp3d});
  if(map.getSource('colonias-3d'))map.getSource('colonias-3d').setData({type:'FeatureCollection',features:col3d});
  map.triggerRepaint();
}
function activateAlcaldias3D(){
  clearAlcLabels();activeTerritoryType=null;showTerritoryLayers();updateSelectedProperties();const names=selectedAlcaldias();
  if(!names.size){fitGeo(alcGeo,{pitch:0,bearing:0});return}
  const nc=new Set([...names].map(clean)),fs=alcGeo.features.filter(f=>nc.has(clean(f.properties.NOMGEO)));
  if(names.size===1){fitGeo({type:'FeatureCollection',features:fs},{pitch:72,bearing:-24,maxZoom:12.6});setTimeout(()=>fs.forEach(showAlcaldiaLabel),650)}
  else{fitGeo({type:'FeatureCollection',features:fs},{pitch:64,bearing:-12,maxZoom:11.5});setTimeout(()=>fs.forEach(f=>showAlcaldiaLabel(f,true)),650)}
}
function activateTerritoryPartition(type){
  clearAlcLabels();activeTerritoryType=type;updateSelectedProperties();showTerritoryLayers();renderLegend();
  const fs=territoryAllInScope(type);if(fs.length)fitGeo({type:'FeatureCollection',features:fs},{pitch:type==='cp'?69:70,bearing:-20,maxZoom:selectedAlcaldias().size>1?12:13.4});
}
function activateTerritory3D(type,value){
  clearAlcLabels();activeTerritoryType=type;updateSelectedProperties();showTerritoryLayers();renderLegend();if(!value){activateTerritoryPartition(type);return}
  const feature=type==='cp'?cpGeo.features.find(f=>String(f.properties.cp)===String(value)):colGeo.features.find(f=>String(f.properties.cvegeo)===String(value));if(feature)fitFeature(feature,{pitch:type==='cp'?73:74,bearing:-26,maxZoom:type==='cp'?15:16})
}
function showAlcaldiaLabel(f,compact=false){const p=f.properties,center=featureCenter(f),html=`<div class="alc-label-card"><b>${esc(p.NOMGEO)}</b><span><strong>${fmt(p.inmuebles)}</strong> inmuebles · <strong>${fmt(p.cct)}</strong> CCT</span>${compact?'':`<span>${fmt(p.publicas)} públicas · ${fmt(p.privadas)} privadas</span>${p.topniv?`<span>${esc(p.topniv)}</span>`:''}`}</div>`;const el=document.createElement('div');el.className='alc-stat-label';el.innerHTML=html;alcLabels.push(new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat(center).addTo(map))}
function clearAlcLabels(){alcLabels.forEach(m=>m.remove());alcLabels=[]}

function searchZoom(){const c=clean($('searchCCT').value),n=clean($('searchName').value),x=schools.find(s=>(c&&clean(s.cct)===c)||(n&&clean(s.nombre)===n));if(!x)return;if(Number.isFinite(x.lat)&&Number.isFinite(x.lon)){map.easeTo({center:[x.lon,x.lat],zoom:17,pitch:45,duration:900});showDetail(x)}if(innerWidth<800)$('sidebar').classList.remove('open')}
function searchTerritory(){if(!territoryReady)return;const cp=clean($('searchCP').value),col=clean($('searchColonia').value);if(cp){const f=cpGeo.features.find(x=>clean(x.properties.cp)===cp);if(f){$('fCPStatus').value=f.properties.inmuebles?'with':'without';activeTerritoryType='cp';refreshTerritoryMenus('cp');$('fCP').value=String(f.properties.cp);render();activateTerritory3D('cp',f.properties.cp);return}}if(col){const f=colGeo.features.find(x=>clean(`${x.properties.nom_asen} · ${x.properties.tipo||'Asentamiento'} · CP ${x.properties.cp||'—'}`)===col)||colGeo.features.find(x=>clean(x.properties.nom_asen)===col)||colGeo.features.find(x=>clean(x.properties.nom_asen).includes(col));if(f){$('fColStatus').value=f.properties.inmuebles?'with':'without';activeTerritoryType='colonia';refreshTerritoryMenus('colonia');$('fColonia').value=String(f.properties.cvegeo);render();activateTerritory3D('colonia',f.properties.cvegeo)}}}
function showDetail(x){$('detailTitle').textContent=x.nombre||x.cct;const prog=x.programas.length?`<div class="pills">${x.programas.map(id=>{const p=programMap.get(id);return `<span class="pill" style="border-left:3px solid ${esc(p?.color||'#789')}">${esc(p?.label||id)}</span>`}).join('')}</div>`:'Sin programa vinculado en el ZIP base';$('detailBody').innerHTML=`<dl><dt>CCT</dt><dd>${esc(x.cct)}</dd><dt>Sostenimiento</dt><dd>${esc(x.sostenimiento)}</dd><dt>Nivel</dt><dd>${esc(x.nivel)}</dd><dt>Alcaldía</dt><dd>${esc(x.alcaldia)}</dd><dt>CP</dt><dd>${esc(x.cp||'Sin coincidencia espacial')}</dd><dt>Asentamiento</dt><dd>${esc(x.asentamiento||'Sin coincidencia espacial')}</dd><dt>Domicilio</dt><dd>${esc(x.domicilio||'Sin dato')}</dd><dt>Programas</dt><dd>${prog}</dd></dl>`;$('detail').classList.add('open')}

function downloadTerritoryList(type){const fs=territoryFeatures(type);if(type==='cp')downloadCSV(`CP_${$('fCPStatus').value==='without'?'sin':'con'}_inmuebles.csv`,[['CP','ALCALDIA','INMUEBLES'],...fs.map(f=>[f.properties.cp,f.properties.alcaldia||'',f.properties.inmuebles])]);else downloadCSV(`Colonias_${$('fColStatus').value==='without'?'sin':'con'}_inmuebles.csv`,[['CVEGEO','COLONIA_ASENTAMIENTO','TIPO','CP','ALCALDIA','INMUEBLES'],...fs.map(f=>[f.properties.cvegeo,f.properties.nom_asen,f.properties.tipo,f.properties.cp,f.properties.alcaldia||'',f.properties.inmuebles])])}
function downloadCSV(name,rows){const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},200)}

function switchView(id){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.navtab').forEach(b=>b.classList.toggle('active',b.dataset.view===id));if(id==='mapView')setTimeout(()=>map.resize(),50);if(id==='statsView')renderStats()}
function renderStats(){if(!meta)return;const arr=visibleInm,s=state();$('sInm').textContent=fmt(arr.length);$('sCct').textContent=fmt(new Set(visible.map(x=>x.cct)).size);$('sCp').textContent=fmt(new Set(arr.map(x=>x.cp).filter(Boolean)).size);$('sCol').textContent=fmt(new Set(arr.map(x=>x.col).filter(Boolean)).size);const parts=[];if(s.alcaldias.size)parts.push(`${s.alcaldias.size} alcaldía${s.alcaldias.size>1?'s':''}`);if(s.cp)parts.push('CP '+s.cp);if(s.col&&colGeo){const f=colGeo.features.find(y=>String(y.properties.cvegeo)===String(s.col));if(f)parts.push(f.properties.nom_asen)}if(s.nivel)parts.push(s.nivel);$('statsScope').textContent=parts.length?parts.join(' · '):`CDMX completa · ${fmt(inmuebles.length)} inmuebles oficiales`;$('inmCount').textContent=fmt(arr.length);renderRanking('cpTop',countTerritory(arr,'cp'),true,'cp');renderRanking('cpBottom',countTerritory(arr,'cp'),false,'cp');renderRanking('colTop',countTerritory(arr,'col'),true,'col');renderRanking('colBottom',countTerritory(arr,'col'),false,'col');renderInmuebles(arr)}
function countTerritory(arr,type){const m=new Map();for(const i of arr){const key=type==='cp'?i.cp:i.col;if(!key)continue;const label=type==='cp'?`CP ${i.cp}`:(i.asentamiento||key);if(!m.has(key))m.set(key,{key,label,count:0});m.get(key).count++}return [...m.values()]}
function renderRanking(id,data,desc,type){const d=data.sort((a,b)=>desc?b.count-a.count:a.count-b.count).slice(0,10),max=Math.max(1,...d.map(x=>x.count));$(id).innerHTML=d.length?d.map((x,i)=>`<div class="rank-row" data-key="${esc(x.key)}" data-type="${type}"><div class="rank-bar" style="width:${x.count/max*100}%"></div><div class="rank-content"><span class="rank-pos">${i+1}</span><span class="rank-name">${esc(x.label)}</span><span class="rank-value">${fmt(x.count)}</span></div></div>`).join(''):'<p class="hint">Sin datos para el filtro actual.</p>';$(id).querySelectorAll('.rank-row').forEach(r=>r.onclick=()=>selectRank(r.dataset.type,r.dataset.key))}
function selectRank(type,key){if(!territoryReady){$('statsScope').textContent='Terminando de preparar CP y colonias…';return}if(type==='cp'){$('fCPStatus').value='with';activeTerritoryType='cp';refreshTerritoryMenus('cp');$('fCP').value=key;$('fColonia').value='';$('searchCP').value=key;$('searchColonia').value=''}else{$('fColStatus').value='with';activeTerritoryType='colonia';refreshTerritoryMenus('colonia');$('fColonia').value=key;$('fCP').value='';const f=colGeo.features.find(s=>String(s.properties.cvegeo)===String(key));$('searchColonia').value=f?.properties?.nom_asen||'';$('searchCP').value=''}render();switchView('mapView');setTimeout(()=>activateTerritory3D(type==='cp'?'cp':'colonia',key),80)}
function renderInmuebles(arr){const sorted=[...arr].sort((a,b)=>(a.cp||'').localeCompare(b.cp||'')||(a.asentamiento||'').localeCompare(b.asentamiento||'')||(b.ccts?.length||0)-(a.ccts?.length||0));$('inmuebleList').innerHTML=sorted.length?sorted.map(i=>`<div class="inm-row" data-key="${esc(i.key)}"><strong>${esc(i.id)} · ${esc(i.asentamiento||i.nombre||'Sin colonia')}</strong><span>CP ${esc(i.cp||'—')} · ${esc(i.alcaldia||'—')}</span><span>${esc(i.domicilio||'Domicilio no disponible')}</span><span class="cct-badge">${i.ccts.length} CCT</span></div>`).join(''):'<p class="hint">No hay inmuebles con los filtros actuales.</p>'}
function showInmueble(key){const i=inmuebles.find(x=>x.key===key)||visibleInm.find(x=>x.key===key);if(!i)return;currentInm=i;$('inmTitle').textContent=`${i.id} · ${i.ccts.length} CCT`;$('inmBody').innerHTML=`<div class="inm-meta"><b>Alcaldía</b><span>${esc(i.alcaldia||'—')}</span><b>CP</b><span>${esc(i.cp||'—')}</span><b>Colonia</b><span>${esc(i.asentamiento||'—')}</span><b>Domicilio</b><span>${esc(i.domicilio||'—')}</span><b>Coordenadas</b><span>${Number.isFinite(i.lat)&&Number.isFinite(i.lon)?`${i.lat.toFixed(6)}, ${i.lon.toFixed(6)}`:'Sin coordenadas'}</span></div>${i.ccts.length?i.ccts.map(cct=>{const c=schoolByCct.get(cct);return c?`<div class="cct-detail"><h4>${esc(c.cct)} · ${esc(c.nombre)}</h4><p><b>Nivel:</b> ${esc(c.nivel)} · <b>Sostenimiento:</b> ${esc(c.sostenimiento)}</p><p><b>Programas:</b> ${c.programas.length?c.programas.map(p=>esc(programMap.get(p)?.label||p)).join(', '):'Sin programa vinculado'}</p></div>`:`<div class="cct-detail"><h4>${esc(cct)}</h4><p>CCT del inmueble sin registro coincidente en la base completa.</p></div>`}).join(''):'<div class="cct-detail"><p>Inmueble oficial sin CCT asociado en esta versión de la base.</p></div>'}`;$('goMapInm').disabled=!(Number.isFinite(i.lat)&&Number.isFinite(i.lon));$('inmModal').classList.add('open')}

function fitGeo(g,opt={}){const b=bboxGeo(g);if(!b)return;map.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:36,duration:900,maxZoom:opt.maxZoom||12});setTimeout(()=>map.easeTo({pitch:opt.pitch??map.getPitch(),bearing:opt.bearing??map.getBearing(),duration:650}),220)}
function fitFeature(f,opt={}){fitGeo({type:'FeatureCollection',features:[f]},opt)}
function bboxGeo(g){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;const scan=c=>{if(!Array.isArray(c))return;if(typeof c[0]==='number'&&typeof c[1]==='number'){minX=Math.min(minX,c[0]);maxX=Math.max(maxX,c[0]);minY=Math.min(minY,c[1]);maxY=Math.max(maxY,c[1]);return}c.forEach(scan)};(g.features||[g]).forEach(f=>scan(f.geometry?.coordinates));return Number.isFinite(minX)?[minX,minY,maxX,maxY]:null}
function featureCenter(f){const b=bboxGeo({type:'FeatureCollection',features:[f]});return b?[(b[0]+b[2])/2,(b[1]+b[3])/2]:[-99.13,19.35]}
