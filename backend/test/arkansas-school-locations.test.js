import test from "node:test";
import assert from "node:assert/strict";
import { fetchArkansasSchoolLocationFeatures, matchArkansasSchoolLocations, relaxedLocationNameKey } from "../src/arkansas-school-locations.js";

function feature(name,city,latitude,longitude,source="arkansas-gis-public"){
  return {source,source_record_id:name,name,address:"1 School Rd",city,postal_code:"72000",latitude,longitude,
    exact_key:name.toLowerCase().replace(/\bhigh school\b/g,"").replace(/[^a-z0-9]+/g," ").trim(),relaxed_key:relaxedLocationNameKey(name)};
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

test("allows a relaxed match only when both the local target and GIS candidate are unique",()=>{
  const schools=[{id:"lakeside-hot-springs",name:"Lakeside High School (Hot Springs)",city:"Hot Springs"}];
  const features=[feature("Lakeside High School","Hot Springs",34.48,-93.06)];
  const result=matchArkansasSchoolLocations(schools,features);
  assert.equal(result.matched.length,1);
  assert.equal(result.matched[0].match_type,"relaxed-unique");
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
