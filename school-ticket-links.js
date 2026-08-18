const SCHOOL_TICKETS = {
  conway: "https://gofan.co/school/AR4663",
  uca: "https://ucasports.universitytickets.com/"
};

const SCHOOL_HOME_COORDS = {
  uca: [LOCAL.uca.lat, LOCAL.uca.lon],
  hendrix: [LOCAL.hendrix.lat, LOCAL.hendrix.lon],
  greenbrier: [LOCAL.greenbrier.lat, LOCAL.greenbrier.lon],
  vilonia: [LOCAL.vilonia.lat, LOCAL.vilonia.lon],
  mayflower: [LOCAL.mayflower.lat, LOCAL.mayflower.lon],
  maumelle: [LOCAL.maumelle.lat, LOCAL.maumelle.lon]
};

for (const event of events) {
  // Any away event that inherited its school's home coordinates because we do
  // not yet have a precise venue coordinate should stay outside the local
  // radius instead of falsely appearing as a Conway-area game.
  if (!event.home && SCHOOL_HOME_COORDS[event.teamId]) {
    const [lat, lon] = SCHOOL_HOME_COORDS[event.teamId];
    if (Math.abs(event.lat - lat) < 0.0001 && Math.abs(event.lon - lon) < 0.0001) {
      event.lat = 0;
      event.lon = 0;
    }
  }

  if (!event.home) continue;
  if (event.teamId === "conway") event.ticketUrl = SCHOOL_TICKETS.conway;
  if (event.teamId === "uca" && event.sport === "football") event.ticketUrl = SCHOOL_TICKETS.uca;
}

render();
