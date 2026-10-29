const SITE = "https://www.asphaltcareservices.com";

// Services, grouped the way the website groups them. `form` is the matching option in the estimate form.
const SERVICES = [
  {
    name: "Asphalt Paving",
    blurb: "Rehabilitation and resurfacing for existing commercial pavement",
    url: "/services/asphalt-paving/",
    items: [
      { id: "lot-paving", name: "Parking Lot Paving", desc: "New and replacement paving for commercial lots", url: "/services/parking-lot-paving/", form: "Asphalt Paving" },
      { id: "overlay", name: "Asphalt Overlay", desc: "A fresh layer of asphalt over sound existing pavement", url: "/services/asphalt-overlay/", form: "Asphalt Paving" },
      { id: "milling", name: "Asphalt Milling", desc: "Precision surface removal for overlays and reconstruction", url: "/services/asphalt-milling/", form: "Asphalt Paving" },
      { id: "rip-out", name: "Rip Out and Replace", desc: "Full removal and rebuild of failed pavement", url: "/services/rip-out-and-replace/", form: "Asphalt Paving" },
    ],
  },
  {
    name: "Asphalt Repair",
    blurb: "Structural repairs for deteriorating commercial pavement",
    url: "/services/asphalt-repair/",
    items: [
      { id: "lot-repair", name: "Parking Lot Repair", desc: "Fix damaged areas before they spread", url: "/services/parking-lot-repair/", form: "Asphalt Repair" },
      { id: "patching", name: "Asphalt Patching", desc: "Repair isolated damaged sections", url: "/services/asphalt-patching/", form: "Asphalt Repair" },
      { id: "saw-cut", name: "Saw Cut and Removal", desc: "Clean cuts to remove and replace failed sections", url: "/services/saw-cut-and-removal/", form: "Asphalt Repair" },
      { id: "pothole", name: "Pothole Repair", desc: "Lasting fixes for potholes of any size", url: "/services/pothole-repair/", form: "Asphalt Repair" },
      { id: "puddle", name: "Puddle Repair", desc: "Correct low spots where water collects", url: "/services/puddle-repair/", form: "Asphalt Repair" },
    ],
  },
  {
    name: "Asphalt Maintenance",
    blurb: "Proactive maintenance programs to maximize pavement life",
    url: "/services/asphalt-maintenance/",
    items: [
      { id: "crack-fill", name: "Crack Filling", desc: "Fill cracks to keep water out of the base", url: "/services/crack-filling/", form: "Asphalt Maintenance" },
      { id: "crack-seal", name: "Crack Sealing", desc: "Seal moving cracks with a flexible sealant", url: "/services/crack-sealing/", form: "Asphalt Maintenance" },
      { id: "sealcoat", name: "Sealcoating", desc: "Commercial-grade protection for parking lots and paved surfaces", url: "/services/sealcoating/", form: "Sealcoating" },
      { id: "striping", name: "Line Striping", desc: "Parking lot lines, arrows and markings", url: "/services/striping/", form: "Line Striping" },
    ],
  },
];
const SERVICE_BY_ID = Object.fromEntries(SERVICES.flatMap((g) => g.items).map((s) => [s.id, s]));

// Pavement checkup: what someone might see, and which services address it
const SYMPTOMS = [
  { label: "Cracks in the surface", icon: '<path d="M4 4l5 6-3 4 5 6M14 3l2 5-3 3 4 4"/>', services: ["crack-fill", "crack-seal"] },
  { label: "Potholes", icon: '<ellipse cx="12" cy="13" rx="8" ry="4"/><path d="M8 12q4 3 8 0"/>', services: ["pothole", "patching"] },
  { label: "Puddles or standing water", icon: '<path d="M12 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9Z"/><path d="M3 21h18"/>', services: ["puddle"] },
  { label: "Faded, gray surface", icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-4 4 3 4-5 5 4"/>', services: ["sealcoat"] },
  { label: "Faded or missing lines", icon: '<path d="M6 3v18M18 3v4M18 11v2M18 17v4"/>', services: ["striping"] },
  { label: "Crumbling or web-like cracks", icon: '<path d="M3 12h18M12 3v18M5 5l14 14M19 5 5 19"/>', services: ["saw-cut", "lot-repair"] },
  { label: "Worn out, rough surface", icon: '<path d="M3 17q3-6 6 0t6 0 6 0"/><path d="M3 10h18"/>', services: ["overlay", "milling"] },
  { label: "Sinking or failed areas", icon: '<path d="M3 8h6l3 6 3-6h6"/><path d="M3 18h18"/>', services: ["rip-out"] },
  { label: "New lot or driveway", icon: '<path d="M12 5v14M5 12h14"/>', services: ["lot-paving"] },
];

// Excerpts from the testimonials on the website
const REVIEWS = [
  { name: "Michael S.", role: "Operations Director, regional mall", text: "I have often had the pleasure of working with Asphalt Care for everything from small “sinkholes” in our parking lot to large scale sealcoating projects." },
  { name: "Jimmy S.", role: "Parking lot striping", text: "Excellent work completed in a timely manner. Staff was extremely professional and the customer service was phenomenal!!" },
  { name: "David L.", role: "Oceanrise Condominium, Jensen Beach", text: "Asphalt Care Services recently completed the re-topping, striping, and replacement of concrete bumpers at Oceanrise Condominium in Jensen Beach, and we could not be more pleased with the results." },
  { name: "Brett", role: "Neighborhood sealcoating", text: "Asphalt care did a great job sealing my neighborhood. Someone drove through their coned off area messing it up and they were still able to fix it perfectly." },
  { name: "Mary M.", role: "Timber Ridge community", text: "Earl and crew were excellent in every aspect. Our whole Timber Ridge Community did the resurfacing of our roads. They are the BEST." },
  { name: "Kim O.", role: "Residential driveway", text: "I highly, highly recommend Asphalt Care Services, LLC. They removed my old tar driveway and replaced it with a new tar driveway." },
  { name: "Toni L.", role: "Community roads", text: "Our community is having its roads resurfaced and the roads look great. The project is being conducted in a professional manner with proper precautions being taken." },
];

const AREAS = [
  ["Stuart, FL", "/"], ["Port St. Lucie, FL", "port-st-lucie-fl"], ["Jensen Beach, FL", "jensen-beach-fl"],
  ["Fort Pierce, FL", "fort-pierce-fl"], ["Vero Beach, FL", "vero-beach-fl"], ["Sebastian, FL", "sebastian-fl"],
  ["Okeechobee, FL", "okeechobee-fl"], ["Jupiter, FL", "jupiter-fl"], ["Palm Beach Gardens, FL", "palm-beach-gardens-fl"],
  ["Riviera Beach, FL", "riviera-beach-fl"], ["West Palm Beach, FL", "west-palm-beach-fl"], ["Wellington, FL", "wellington-fl"],
  ["Delray Beach, FL", "delray-beach-fl"], ["Boca Raton, FL", "boca-raton-fl"],
];

const $ = (id) => document.getElementById(id);
const link = (path) => `href="${SITE}${path}" target="_blank" rel="noopener"`;
const chevron = '<svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>';

// ---------- Services ----------

$("service-list").innerHTML = SERVICES.map((group, i) => `
  <details class="service"${i === 0 ? " open" : ""}>
    <summary>
      <span class="num">0${i + 1}</span>
      <div><h3>${group.name}</h3><p>${group.blurb}</p></div>
      ${chevron}
    </summary>
    <div class="body">
      <ul>${group.items.map((s) => `<li><a ${link(s.url)}><b>${s.name}</b><span>${s.desc}</span></a></li>`).join("")}</ul>
      <a class="more" ${link(group.url)}>More about ${group.name.toLowerCase()} →</a>
    </div>
  </details>`).join("");

// ---------- Pavement checkup ----------

$("symptoms").innerHTML = SYMPTOMS.map((s, i) =>
  `<button type="button" class="symptom" data-i="${i}" aria-pressed="false"><svg viewBox="0 0 24 24">${s.icon}</svg>${s.label}</button>`).join("");

let recommended = [];
$("symptoms").addEventListener("click", (e) => {
  const btn = e.target.closest(".symptom");
  if (!btn) return;
  btn.setAttribute("aria-pressed", btn.getAttribute("aria-pressed") === "true" ? "false" : "true");

  const picked = [...document.querySelectorAll('.symptom[aria-pressed="true"]')].map((b) => SYMPTOMS[b.dataset.i]);
  recommended = [...new Set(picked.flatMap((s) => s.services))].map((id) => SERVICE_BY_ID[id]);
  $("advice").hidden = recommended.length === 0;
  $("advice-list").innerHTML = recommended.map((s) => `<li><a ${link(s.url)}>${s.name}</a><p>${s.desc}</p></li>`).join("");
  $("advice").dataset.symptoms = picked.map((s) => s.label).join(", ");
});

// Carry the checkup results into the estimate form
$("advice-cta").addEventListener("click", () => {
  if (!recommended.length) return;
  $("service-select").value = recommended[0].form;
  $("message").value = `Pavement checkup: ${$("advice").dataset.symptoms}.\nInterested in: ${recommended.map((s) => s.name).join(", ")}.`;
});

// ---------- Reviews ----------

$("review-list").innerHTML = REVIEWS.map((r) => `
  <article class="review">
    <p>“${r.text}”</p>
    <footer><span class="avatar">${r.name[0]}</span><span>${r.name}<small>${r.role}</small></span></footer>
  </article>`).join("");

// ---------- Areas ----------

$("area-list").innerHTML = AREAS.map(([name, slug]) => slug === "/"
  ? `<a class="hq" ${link("/")}>${name} · HQ</a>`
  : `<a ${link(`/areas-we-serve/${slug}/`)}>${name}</a>`).join("");

// ---------- Estimate form (submitted through Netlify Forms) ----------

$("estimate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = $("form-status");
  status.className = "form-status";
  status.textContent = "Sending…";
  try {
    const res = await fetch("/", { method: "POST", body: new FormData(form) });
    if (!res.ok) throw new Error(res.statusText);
    form.reset();
    status.className = "form-status ok";
    status.textContent = "Thanks! We received your request and will contact you shortly.";
  } catch (err) {
    status.className = "form-status err";
    status.textContent = "Sorry, that didn't go through. Please call us at 772.888.2840.";
    console.error(err);
  }
});

// ---------- Highlight the current section in the tab bar ----------

const tabs = [...document.querySelectorAll(".tabs a")];
const sections = tabs.map((a) => document.querySelector(a.getAttribute("href")));
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) tabs.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${entry.target.id}`));
  });
}, { rootMargin: "-45% 0px -50% 0px" });
sections.forEach((s) => observer.observe(s));

$("year").textContent = new Date().getFullYear();
