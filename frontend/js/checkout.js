// Checkout with payment (Feature 4). Uses cartLines() from cart.js.
const payBtn = document.getElementById("pay-btn");
const message = document.getElementById("message");
let total = 0;
payBtn.disabled = true;
if (!USE_MOCK) {
  document.querySelector(".page-sub").textContent = "Confirm your details to book free tickets.";
  document.getElementById("payment-box").classList.add("hidden");
}

function setError(id, text) {
  document.getElementById(id + "-error").textContent = text;
  document.getElementById(id).classList.toggle("invalid", !!text);
}

function digits(id) { return document.getElementById(id).value.replace(/\D/g, ""); }

// Standard card-number checksum (Luhn)
function luhnOk(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function validateCard() {
  ["cardName", "cardNumber", "cardExpiry", "cardCvv"].forEach(f => setError(f, ""));
  let ok = true;
  if (!document.getElementById("cardName").value.trim()) { setError("cardName", "Enter the name on the card."); ok = false; }

  const num = digits("cardNumber");
  if (num.length < 15 || num.length > 16 || !luhnOk(num)) { setError("cardNumber", "Enter a valid card number."); ok = false; }

  const exp = document.getElementById("cardExpiry").value.trim();
  const m = exp.match(/^(\d{2})\/(\d{2})$/);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) { setError("cardExpiry", "Use MM/YY."); ok = false; }
  else {
    const now = new Date();
    const expEnd = new Date(2000 + Number(m[2]), Number(m[1]), 1); // first day after the expiry month
    if (expEnd <= now) { setError("cardExpiry", "This card has expired."); ok = false; }
  }

  const cvv = digits("cardCvv");
  if (cvv.length < 3) { setError("cardCvv", "3 or 4 digits."); ok = false; }
  return ok;
}

// Format the card number as 1234 5678 9012 3456 while typing
document.getElementById("cardNumber").addEventListener("input", e => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
});
document.getElementById("cardExpiry").addEventListener("input", e => {
  const d = e.target.value.replace(/\D/g, "").slice(0, 4);
  e.target.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
});

function renderCheckout() {
  const lines = cartLines();
  if (!lines.length) { window.location.href = "cart.html"; return; }
  payBtn.disabled = lines.some(l => l.problem);
  if (payBtn.disabled) {
    showMessage(message, "Some items in your cart need attention. Go back to your cart to fix them.", "error");
    payBtn.disabled = true;
  }
  total = cartTotal(lines);

  const me = find("Users", user.UserID) || user;
  document.getElementById("student-name").value = fullName(me);
  document.getElementById("student-id").value = me.StudentID || "";
  document.getElementById("student-email").value = me.Email;

  document.getElementById("payment-box").classList.toggle("hidden", total === 0);
  document.getElementById("free-box").classList.toggle("hidden", total > 0);
  if (!USE_MOCK && total > 0) {
    document.getElementById("payment-box").classList.add("hidden");
    showMessage(message, "Checkout currently supports free tickets only.", "error");
    payBtn.disabled = true;
  }
  payBtn.textContent = total > 0 ? (!USE_MOCK ? "Paid checkout unavailable" : "Pay $" + total.toFixed(2) + " and book") : "Confirm free booking";

  document.getElementById("summary").innerHTML = lines.filter(l => l.ev).map(l => `
    <div class="summary-line"><span><strong>${esc(l.ev.Title)}</strong><br>
      <small class="event-meta">${l.Quantity} × ${esc(l.type.Name)} · ${fmtDate(l.ev.EventDate)}</small></span>
      <span>${l.lineTotal === 0 ? "Free" : "$" + l.lineTotal.toFixed(2)}</span></div>`).join("") +
    `<div class="total-row"><span>Total</span><span>$${total.toFixed(2)}</span></div>`;
}

document.getElementById("checkout-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (total > 0 && (!USE_MOCK || !validateCard())) return;

  payBtn.disabled = true;
  payBtn.textContent = "Booking...";
  try {
    const items = getCart().map(c => ({ TicketTypeID: c.TicketTypeID, Quantity: c.Quantity }));
    const payment = total > 0 ? { cardLast4: digits("cardNumber").slice(-4) } : null;
    const booking = await createBooking(user.UserID, items, payment);
    saveCart([]);
    window.location.href = "booking.html?id=" + booking.BookingID + "&new=1";
  } catch (err) {
    showMessage(message, err.message, "error");
    window.scrollTo(0, 0);
    payBtn.disabled = false;
    await loadAll();
    renderCheckout();
  }
});

if (user) loadAll().then(renderCheckout);
