// Offline native Shafeh responses built from the existing trimmed text fixture.
import fixture from "./fixture-library";
const old = fixture as any;
const slug = (s: string) => s.toLowerCase().replace(/ /g, "-");
export const shapes: Record<string, any> = {};
export const urls: Record<string, any> = {};
const values = (j: any, lang: string) => j?.versions?.find((v: any) => v.language === lang)?.text ?? [];
for (const [shapeName, coll, endpoint] of [["Mishnah", "mishnah", "mishnah"], ["Bavli", "bavli", "shas"], ["Halakhah/Mishneh Torah", "mt", "rambam"]]) {
  const groups: any[] = [];
  for (const b of old.shapes[shapeName!]) {
    if (b.isComplex) continue;
    let group = groups.find((g) => g.name === b.section);
    if (!group) groups.push(group = { name: b.section, items: [] });
    const name = b.title.replace(/^Mishnah /, "").replace(/^Mishneh Torah, /, "");
    const key = slug(name);
    const he = b.heTitle.replace(/^משנה תורה, /, "").replace(/^משנה /, "");
    const first = coll === "bavli" ? Math.floor(b.chapters.findIndex((v: number) => v > 0) / 2) + 1 : 1;
    const last = coll === "bavli" ? Math.floor((b.chapters.length - 1) / 2) + 1 : b.chapters.length;
    group.items.push(coll === "mt" ? { slug: key, name, he, chapters: last } : { key, en: name, he, perakim: last,
      first_amud: `${first}${coll === "bavli" && b.chapters[2 * (first - 1)] === 0 ? "b" : "a"}`,
      last_amud: `${last}${b.chapters.length % 2 ? "a" : "b"}` });
    for (let unit = first; unit <= last; unit++) {
      const ref = `${b.title} ${unit}`;
      const j = old.texts[ref];
      if (!j) continue;
      if (coll === "bavli") {
        const single = /[ab]$/.test(j.ref);
        const hs = single ? [values(j, "he")] : values(j, "he");
        const rs = values(old.texts[`Rashi on ${ref}`], "he");
        const rashi = single ? [rs] : rs;
        hs.forEach((h: string[], i: number) => {
          const side = single ? j.ref.slice(-1) : i === 0 ? "a" : "b";
          urls[`shas/${key}/${unit}${side}`] = { daf: `${unit}${side}`, lines: h.map((he, i) => ({ n: i + 1, he })),
            rashi: (rashi[i] ?? []).flat().map((c: string) => ({ d: "רש״י", c })) };
        });
      } else {
        urls[`${endpoint}/${key}/${unit}`] = { [coll === "mt" ? "halachos" : "mishnayos"]:
          values(j, "he").map((he: string, i: number) => coll === "mt" ? { number: i + 1, text: he, english: values(j, "en")[i] } : { n: i + 1, he }) };
      }
    }
  }
  shapes[shapeName!] = coll === "mt" ? { sefarim: groups.map((g) => ({ sefer: g.name.replace(/^Sefer /, ""), he: "ספר המדע", sections: g.items })) }
    : { sedarim: groups.map((g) => ({ en: g.name.replace(/^Seder /, ""), he: g.name, masechtos: g.items })) };
  urls[endpoint!] = shapes[shapeName!];
}
export function unitText(coll: string, key: string, unit: number) {
  return coll === "bavli" ? { amudim: ["a", "b"].map((s) => urls[`shas/${key}/${unit}${s}`]).filter(Boolean) }
    : urls[`${coll === "mt" ? "rambam" : "mishnah"}/${key}/${unit}`];
}
export const today = { hebrew_date: { day: 25, month_name: "Tishrei", year: 5787, hebrew: "" },
  limudim: [{ key: "chitas_tanya", value: "25 Tishrei" }, { key: "tehillim", value: "119:1–96" }] };
