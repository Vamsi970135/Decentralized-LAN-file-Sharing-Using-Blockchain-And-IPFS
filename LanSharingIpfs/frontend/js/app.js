document.addEventListener('DOMContentLoaded', () => {

  const token = localStorage.getItem('token');
  const authSection = document.getElementById('auth-section');
  const mainSection = document.getElementById('main-section');

  if (token) {
    authSection?.classList.add('hidden');
    mainSection?.classList.remove('hidden');
    loadUserActivity();
  }

  // ================= LOGIN =================
  document.getElementById('login-btn')?.addEventListener('click', async () => {

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (response.ok) {

      localStorage.setItem('token', data.token);

      authSection?.classList.add('hidden');
      mainSection?.classList.remove('hidden');

      loadUserActivity();

    } else {
      alert(data.message);
    }
  });

  // ================= REGISTER =================
  document.getElementById('register-btn')?.addEventListener('click', async () => {

    const username = prompt('Enter username:');
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });

    const data = await response.json();

    alert(data.message);

  });

  // ================= LOGOUT =================
  document.getElementById('logout-btn')?.addEventListener('click', () => {

    localStorage.removeItem('token');

    authSection?.classList.remove('hidden');
    mainSection?.classList.add('hidden');

  });

});

// ================= LOAD USER ACTIVITY =================

async function loadUserActivity() {

  const token = localStorage.getItem("token");

  if (!token) return;

  const payload = JSON.parse(atob(token.split('.')[1]));

  const userId = payload.id;

  const res = await fetch(`/api/user-activity/${userId}`);

  if (!res.ok) return;

  const data = await res.json();

  const fileBox = document.getElementById("user-files");
  const txBox = document.getElementById("user-transactions");

  if (!fileBox || !txBox) return;

  fileBox.innerHTML = "";
  txBox.innerHTML = "";

  data.files.forEach(f => {

    const div = document.createElement("div");

    div.innerText =
      `${f.filename} (${(f.size / 1024).toFixed(1)} KB)`;

    fileBox.appendChild(div);

  });

  data.transactions.forEach(tx => {

    const div = document.createElement("div");

    const d = JSON.parse(tx.data);

    div.innerText =
      `${d.action} : ${d.filename}`;

    txBox.appendChild(div);

  });

}