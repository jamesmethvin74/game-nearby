import test from "node:test";
import assert from "node:assert/strict";
import { fetchArkansasSchoolLocationFeatures, locationNameKey, matchArkansasSchoolLocations, relaxedLocationNameKey } from "../src/arkansas-school-locations.js";

function strictKey(value){
  return String(value??"").replace(/\s+/g," ").trim().replace(/[–—]/g,"-").replace(/\bH\s*S\b/gi,"High School").replace(/\bschools\b/gi,"school")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}

function feature(name,city,latitude,longitude,source="arkansas-gis-public"){
  const relaxed=relaxedLocationNameKey(name);
  const cityKey=locationNameKey(city);
  const tokens=relaxed.split(" ").filter(Boolean);
  const cityTokens=cityKey.split(" ").filter(Boolean);
  const remaining=[...tokens];
  if (cityTokens.every(token=>remaining.includes(token))) for (const token of cityTokens) remaining.splice(remaining.indexOf(token),1);
  return {source,source_record_id:name,name,address:"1 School Rd",city,postal_code:"72000",latitude,longitude,
    exact_key:locationNameKey(name),strict_key:strictKey(name),relaxed_key:relaxed,structural_key:relaxed,structural_without_city:remaining.join(" ")};
}

test("matches unique public and private Arkansas school points without fuzzy guessing",()=>{
  const schools=[
    {id:"greenbrier",name:"Greenbrier High School",city:"Greenbrier"},
    {id:"mount-st-mary",name:"Mount St Mary Academy",city:"Little Rock"}
  ];
  const features=[
    feature("GREENBRIER HIGH SCHOOL","Greenbrier",35.23,-92.38),
    feature("Mount St Mary Academy","Little Rock",34.75,-92.29,"arkansas-gis-private")
  ];
  const result=matchArkansasSchoolLocations(schools,features);
  assert.equal(result.matched.length,2);
  assert.equal(result.unresolved.length,0);
  assert.equal(result.ambiguous.length,0);
  assert.equal(result.matched.find(row=>row.school_id==="mount-st-mary").source,"arkansas-gis-private");
});

test("quarantines duplicate local school names instead of assigning one point twice",()=>{
  const schools=[
    {id:"benton-a",name:"Benton High School",city:""},
    {id:"benton-b",name:"Benton High School",city:""}
  ];
  const features=[feature("Benton High School","Benton",34.56,-92.59)];
  const result=matchArkansasSchoolLocations(schools,features);
  assert.equal(result.matched.length,0);
  assert.equal(result.ambiguous.length,2);
  assert.ok(result.ambiguous.every(row=>row.reason==="duplicate-local-name"));
});

test("uses explicit city qualifiers to resolve otherwise ambiguous Arkansas names",()=>{
  const schools=[
    {id:"lakeside-hot-springs",name:"Lakeside High School (Hot Springs)",city:""},
    {id:"st-joseph-conway",name:"St. Joseph Catholic School - Conway",city:""}
  ];
  const features=[
    feature("Lakeside High School","Hot Springs",34.48,-93.06),
    feature("Lakeside High School","Lake Village",33.33,-91.28),
    feature("St. Joseph Catholic School","Conway",35.09,-92.44,"arkansas-gis-private"),
    feature("St. Joseph Catholic School","Fayetteville",36.07,-94.16,"arkansas-gis-private"),
    feature("St. Joseph Catholic School","Paris",35.29,-93.73,"arkansas-gis-private")
  ];
  const result=matchArkansasSchoolLocations(schools,features);
  assert.equal(result.matched.length,2);
  assert.equal(result.matched.find(row=>row.school_id==="lakeside-hot-springs").city,"Hot Springs");
  assert.equal(result.matched.find(row=>row.school_id==="st-joseph-conway").city,"Conway");
});

test("normalizes documented Arkansas DOE naming wrappers without generic fuzzy matching",()=>{
  const schools=[
    {id:"cave-city",name:"Cave City High School",city:""},
    {id:"jonesboro",name:"Jonesboro High School",city:""},
    {id:"siloam",name:"Siloam Springs High School",city:""},
    {id:"founders",name:"Founders Classical Academy - Rogers",city:""},
    {id:"baptist",name:"The Baptist Preparatory School",city:""},
    {id:"union",name:"UNION CHRISTIAN ACADEMY 7-12",city:""}
  ];
  const features=[
    feature("Cave City High Career And Collegiate Preparatory School","Cave City",35.94,-91.55),
    feature("The Academies At Jonesboro High School","Jonesboro",35.84,-90.70),
    feature("Siloam Springs High School Conversion Charter","Siloam Springs",36.18,-94.54),
    feature("Founders Classical Academies Of Arkansas High School Rogers","Rogers",36.31,-94.21),
    feature("Baptist Preparatory School","Little Rock",34.75,-92.30,"arkansas-gis-private"),
    feature("Union Christian Academy","Fort Smith",35.38,-94.40,"arkansas-gis-private")
  ];
  const result=matchArkansasSchoolLocations(schools,features);
  assert.equal(result.matched.length,6);
  assert.equal(result.unresolved.length,0);
  assert.equal(result.ambiguous.length,0);
});

test("maps known Arkansas athletic legacy names only to specific current GIS schools",()=>{
  const schools=[
    {id:"batesville",name:"Batesville High School",city:""},
    {id:"central-wh",name:"Central West Helena",city:""},
    {id:"harmony-haskell",name:"HARMONY GROVE HIGH SCHOOL – HASKELL",city:""},
    {id:"harmony-camden",name:"Harmony Grove High School (Camden)",city:""},
    {id:"izard",name:"IZARD CO. CONS. HIGH SCHOOL",city:""},
    {id:"lee",name:"LEE COUNTY HIGH SCHOOL",city:""},
    {id:"lr-central",name:"Little Rock Central High School",city:""},
    {id:"morrilton",name:"Morrilton Sr. High School (7-12 athletics)",city:""},
    {id:"mountain-home",name:"MOUNTAIN HOME HIGH SCHOOL",city:""},
    {id:"newport",name:"NEWPORT HIGH SCHOOL",city:""},
    {id:"rivercrest",name:"Rivercrest High School",city:""},
    {id:"west-memphis",name:"West Memphis High School",city:""}
  ];
  const features=[
    feature("Batesville High School Charter","Batesville",35.77,-91.64),
    feature("Batesville Junior High School Charter","Batesville",35.77,-91.65),
    feature("Central High School","West Helena",34.55,-90.64),
    feature("Central High School","Little Rock",34.74,-92.30),
    feature("Harmony Grove High School","Benton",34.56,-92.70),
    feature("Harmony Grove High School","Camden",33.59,-92.83),
    feature("Izard County Consolidated High School","Brockwell",36.14,-91.94),
    feature("Lee High School","Marianna",34.77,-90.76),
    feature("Lee Academy","Marianna",34.76,-90.75,"arkansas-gis-private"),
    feature("Morrilton Junior High School","Morrilton",35.15,-92.74),
    feature("Morrilton Senior High School","Morrilton",35.16,-92.74),
    feature("Mountain Home Christian Academy","Mountain Home",36.34,-92.38,"arkansas-gis-private"),
    feature("Mountain Home High School (Career Academies)","Mountain Home",36.34,-92.39),
    feature("Newport Junior High School","Newport",35.61,-91.28),
    feature("The Academies At Newport High School","Newport",35.60,-91.28),
    feature("Academies At Rivercrest High School","Wilson",35.56,-90.04),
    feature("Rivercrest Junior High Prep Academy","Wilson",35.55,-90.04),
    feature("The Academies Of West Memphis Charter School","West Memphis",35.15,-90.18),
    feature("West Memphis Christian School","West Memphis",35.14,-90.18,"arkansas-gis-private")
  ];
  const result=matchArkansasSchoolLocations(schools,features);
  assert.equal(result.matched.length,schools.length);
  assert.equal(result.unresolved.length,0);
  assert.equal(result.ambiguous.length,0);
  assert.equal(result.matched.find(row=>row.school_id==="harmony-haskell").city,"Benton");
  assert.equal(result.matched.find(row=>row.school_id==="harmony-camden").city,"Camden");
  assert.equal(result.matched.find(row=>row.school_id==="lr-central").matched_name,"Central High School");
  assert.equal(result.matched.find(row=>row.school_id==="west-memphis").matched_name,"The Academies Of West Memphis Charter School");
  assert.ok(result.matched.every(row=>row.match_type==="official-alias-city"));
});

test("does not turn a similar out-of-state opponent into an Arkansas school",()=>{
  const schools=[{id:"carl-junction",name:"Carl Junction High School",city:""}];
  const features=[feature("Junction City High School","Junction City",33.01,-92.72)];
  const result=matchArkansasSchoolLocations(schools,features);
  assert.equal(result.matched.length,0);
  assert.equal(result.unresolved.length,1);
});

test("paginates Arkansas GIS feature layers and requests WGS84 output coordinates",async()=>{
  const calls=[];
  const fetchFn=async url=>{
    calls.push(url);
    const parsed=new URL(url);
    const layer=Number(parsed.pathname.split("/").at(-2));
    const offset=Number(parsed.searchParams.get("resultOffset"));
    assert.equal(parsed.searchParams.get("outSR"),"4326");
    const make=(id,name)=>({attributes:{objectid:id,name,address:"A",city:"C",zipcode:"72000",lea:"L"},geometry:{x:-92.4,y:35.1}});
    let features=[];
    let exceededTransferLimit=false;
    if (layer===39 && offset===0) { features=[make(1,"Alpha High School"),make(2,"Beta High School")]; exceededTransferLimit=true; }
    else if (layer===39 && offset===2) features=[make(3,"Gamma High School")];
    else if (layer===37 && offset===0) features=[make(4,"Private Academy")];
    return {ok:true,status:200,json:async()=>({features,exceededTransferLimit})};
  };
  const result=await fetchArkansasSchoolLocationFeatures({fetchFn,pageSize:2});
  assert.equal(result.publicFeatures.length,3);
  assert.equal(result.privateFeatures.length,1);
  assert.equal(calls.length,3);
});
