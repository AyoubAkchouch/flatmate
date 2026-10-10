// Universities students can pick as their destination.
// Travel times on each flat are measured to the chosen one. Add more here.
export const UNIVERSITIES = [
  { name: "Sciences Po", short: "Sciences Po", lat: 48.8541, lng: 2.3283 },
  { name: "Sorbonne Université (Jussieu)", short: "Sorbonne Université", lat: 48.8466, lng: 2.3560 },
  { name: "Université Paris Cité (Grands Moulins)", short: "Université Paris Cité", lat: 48.8290, lng: 2.3810 },
  { name: "Université Paris 8 (Saint-Denis)", short: "Paris 8", lat: 48.9450, lng: 2.3630 },
  { name: "Université Paris Dauphine-PSL", short: "Dauphine", lat: 48.8708, lng: 2.2740 },
  { name: "ESSEC (Cergy)", short: "ESSEC", lat: 49.0333, lng: 2.0759 },
];

export const findUniversity = (name) => UNIVERSITIES.find((u) => u.name === name) || null;
