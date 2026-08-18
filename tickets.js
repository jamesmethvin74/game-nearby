const CONWAY_TICKETS_URL = "https://gofan.co/school/AR4663";

function addTicketActions() {
  document.querySelectorAll(".event-actions").forEach(actions => {
    if (actions.querySelector(".ticket-action")) return;
    const ticket = document.createElement("a");
    ticket.className = "ticket-action";
    ticket.href = CONWAY_TICKETS_URL;
    ticket.target = "_blank";
    ticket.rel = "noopener";
    ticket.textContent = "Tickets";
    ticket.setAttribute("aria-label", "Buy or view tickets on GoFan");
    const calendar = [...actions.querySelectorAll("a")].find(a => a.textContent.trim() === "Calendar");
    if (calendar) actions.insertBefore(ticket, calendar);
    else actions.appendChild(ticket);
  });
}

const ticketObserver = new MutationObserver(addTicketActions);
ticketObserver.observe(document.body, { childList: true, subtree: true });
addTicketActions();
