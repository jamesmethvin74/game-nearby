import test from "node:test";
import assert from "node:assert/strict";
import { applyVerifiedBrandAssets } from "../src/catalog-identity-worker.js";

test("catalog identity overlay restores local zero-team colleges without exposing Three Rivers", async () => {
  const existing = [
    { id:"df-demo", name:"Demo High School", city:"Demo", state:"AR", level:"high-school", catalog_scope:"local", team_count:3, logo_url:"https://old.example/demo.png", mascot:"Demo" },
    { id:"uark", name:"University of Arkansas", city:"Fayetteville", state:"AR", level:"college", catalog_scope:"local", team_count:5, logo_url:"https://old.example/uark.png", mascot:"Razorbacks" }
  ];

  let sql = "";
  let bound = null;
  const env = {
    DB: {
      prepare(statement) {
        sql = statement;
        return {
          bind(value) {
            bound = value;
            return {
              async all() {
                return { results:[
                  { id:"df-demo", name:"Demo High School", city:"Demo", state:"AR", level:"high-school", catalog_scope:"local", logo_url:"https://old.example/demo.png", mascot:"Demo", brand_logo_url:"https://brand.example/demo.png", brand_mascot:"Demons" },
                  { id:"uark", name:"University of Arkansas", city:"Fayetteville", state:"AR", level:"college", catalog_scope:"local", logo_url:"https://old.example/uark.png", mascot:"Razorbacks", brand_logo_url:"https://brand.example/uark.png", brand_mascot:"Razorbacks" },
                  { id:"asu-mid-south", name:"Arkansas State University Mid-South", city:"West Memphis", state:"AR", level:"college", catalog_scope:"local", logo_url:"https://school.example/ms.png", mascot:"Greyhounds", brand_logo_url:"https://brand.example/ms.png", brand_mascot:"Greyhounds" },
                  { id:"asu-three-rivers", name:"Arkansas State University Three Rivers", city:"Malvern", state:"AR", level:"college", catalog_scope:"local", logo_url:"https://school.example/tr.png", mascot:"Eagles", brand_logo_url:"https://brand.example/tr.png", brand_mascot:"Eagles" }
                ] };
              }
            };
          }
        };
      }
    }
  };

  const result = await applyVerifiedBrandAssets(env, existing);
  const byId = new Map(result.map(row => [row.id,row]));

  assert.match(sql, /s\.catalog_scope='local' AND s\.level='college'/);
  assert.match(sql, /s\.id <> 'asu-three-rivers'/);
  assert.deepEqual(JSON.parse(bound).sort(), ["df-demo","uark"]);
  assert.equal(byId.get("df-demo").team_count, 3);
  assert.equal(byId.get("df-demo").logo_url, "https://brand.example/demo.png");
  assert.equal(byId.get("uark").team_count, 5);
  assert.equal(byId.get("asu-mid-south").team_count, 0);
  assert.equal(byId.get("asu-mid-south").logo_url, "https://brand.example/ms.png");
  assert.equal(byId.has("asu-three-rivers"), false);
});
