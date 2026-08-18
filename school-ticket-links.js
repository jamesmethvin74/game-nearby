const SCHOOL_TICKETS = {
  conway: "https://gofan.co/school/AR4663",
  uca: "https://ucasports.universitytickets.com/"
};

for (const event of events) {
  if (!event.home) continue;
  if (event.teamId === "conway") event.ticketUrl = SCHOOL_TICKETS.conway;
  if (event.teamId === "uca" && event.sport === "football") event.ticketUrl = SCHOOL_TICKETS.uca;
}

render();
