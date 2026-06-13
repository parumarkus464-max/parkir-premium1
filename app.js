// ==========================================
// KONFIGURASI FIREBASE
// ==========================================
const firebaseConfig = {
    apiKey: "AIzaSyAVoYEeOwl4Ndzq4J4FsIKmoc8zyzRtodQ",
    authDomain: "parkir-premium.firebaseapp.com",
    databaseURL: "https://parkir-premium-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "parkir-premium",
    storageBucket: "parkir-premium.firebasestorage.app",
    messagingSenderId: "768016342610",
    appId: "1:768016342610:web:d4b4ec374f54fe64d9c98b",
    measurementId: "G-5QBVK8W2M0"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ==========================================
// STATE & CONSTANTS
// ==========================================
let currentUser = null;
let selectedMember = null;
let scannerInstance = null;
let settings = { tarif_motor: 1000, tarif_mobil: 3000, diskon: 10, biaya_motor: 30000, biaya_mobil: 90000 };
let isTopupProcessing = false;

// ==========================================
// UTILITIES
// ==========================================
function formatRupiah(n) {
    return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function hashPassword(pwd) {
    return CryptoJS.SHA256(pwd).toString();
}

function sanitize(s) {
    return (s || '').replace(/[;'"]/g, '').trim();
}

function isValidNIK(nik) {
    return /^\d{10,20}$/.test(nik);
}

function genMemberNo() {
    const d = new Date();
    const ym = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0');
    return 'MEM' + ym + Math.floor(1000 + Math.random()*9000);
}

function formatTanggal(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const hari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
    const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    return `${hari[d.getDay()]}, ${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTanggalSingkat(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    return `${d.getDate()} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

function greeting() {
    const h = new Date().getHours();
    if (h < 11) return 'Selamat Pagi';
    if (h < 15) return 'Selamat Siang';
    if (h < 18) return 'Selamat Sore';
    return 'Selamat Malam';
}

function toast(msg, type='info') {
    const t = document.getElementById('toast');
    t.className = 'toast ' + type;
    t.innerHTML = `<span style="font-size:20px;">${type==='success'?'✅':type==='error'?'❌':'ℹ️'}</span><span>${msg}</span>`;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
}

function showModal(title, content) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalContent').innerHTML = content;
    document.getElementById('modal').classList.add('active');
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

// ==========================================
// AUTH & SESSION
// ==========================================
function saveSession(user) {
    const sessionData = {
        username: user.username,
        role: user.role,
        nama: user.nama || user.username,
        loginTime: new Date().getTime(),
        expiresAt: new Date().getTime() + (24 * 60 * 60 * 1000)
    };
    localStorage.setItem('parkir_session', JSON.stringify(sessionData));
}

function loadSession() {
    const sessionStr = localStorage.getItem('parkir_session');
    if (!sessionStr) return null;
    try {
        const session = JSON.parse(sessionStr);
        if (session.expiresAt && session.expiresAt > new Date().getTime()) {
            return session;
        } else {
            localStorage.removeItem('parkir_session');
            return null;
        }
    } catch (e) {
        localStorage.removeItem('parkir_session');
        return null;
    }
}

function clearSession() {
    localStorage.removeItem('parkir_session');
}

function checkAuth() {
    const session = loadSession();
    if (session) {
        // Pastikan role terbaca dengan benar
        currentUser = { 
            username: session.username, 
            role: (session.role || 'member').toString().toLowerCase().trim(),
            nama: session.nama || session.username
        };
        
        console.log(' Auto-login - currentUser:', currentUser);
        
        applyRoleUI();
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('mainApp').classList.add('active');
        
        initApp();
        console.log('✅ Auto-login berhasil:', currentUser.username, 'role:', currentUser.role);
        return true;
    }
    return false;
}

async function initDefaultUsers() {
    const snap = await db.ref('users').once('value');
    if (!snap.exists()) {
        await db.ref('users').set({
            admin: { 
                username: 'admin', 
                password: hashPassword('admin123'), 
                role: 'admin',
                nama: 'Administrator'
            },
            operator: { 
                username: 'operator', 
                password: hashPassword('op123'), 
                role: 'operator',
                nama: 'Operator'
            }
        });
        console.log('✅ Default users created');
    }
}

async function initDefaultSettings() {
    const snap = await db.ref('settings').once('value');
    if (!snap.exists()) {
        await db.ref('settings').set({
            tarif_motor: 1000, tarif_mobil: 3000, diskon: 10,
            biaya_motor: 30000, biaya_mobil: 90000
        });
    } else {
        settings = snap.val();
    }
}

async function doLogin() {
    const u = sanitize(document.getElementById('loginUser').value);
    const p = document.getElementById('loginPass').value;
    if (!u || !p) return toast('Username & password wajib diisi', 'error');
    
    const snap = await db.ref('users/' + u).once('value');
    const user = snap.val();
    
    console.log(' Login attempt - username:', u, '| user data:', user);
    
    if (!user || user.password !== hashPassword(p)) {
        return toast('Username atau password salah', 'error');
    }
    
    // Pastikan role ada dan valid
    if (!user.role) {
        user.role = 'member'; // Default fallback
        console.log('⚠️ Role tidak ada, default ke member');
    }
    
    // Simpan ke currentUser dengan struktur yang jelas
    currentUser = {
        username: user.username || u,
        password: user.password,
        role: user.role.toString().toLowerCase().trim(),
        nama: user.nama || user.username || u,
        createdAt: user.createdAt || new Date().toISOString()
    };
    
    console.log('✅ currentUser set:', currentUser);
    
    saveSession(currentUser);
    
    applyRoleUI();
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainApp').classList.add('active');
    
    initApp();
    toast(`Selamat datang, ${currentUser.nama}! (${currentUser.role.toUpperCase()})`, 'success');
}

function doLogout() {
    if (!confirm('Yakin ingin logout?')) return;
    currentUser = null;
    clearSession();
    
    if (scannerInstance) { try { scannerInstance.stop(); } catch(e){} }
    document.getElementById('mainApp').classList.remove('active');
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginPass').value = '';
    document.getElementById('loginUser').value = '';
}

// ==========================================
// MANAGE USERS (Admin Only)
// ==========================================
async function renderUserList() {
    const snap = await db.ref('users').once('value');
    const users = snap.val() || {};
    const list = document.getElementById('userList');
    const userArray = Object.values(users);
    
    if (userArray.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">👥 Belum ada user</p>';
        return;
    }
    
    list.innerHTML = `
        <div style="margin-top:16px;">
            <h4 style="margin-bottom:12px;color:var(--text-primary);">Daftar Petugas & User:</h4>
            ${userArray.map(u => `
                <div class="list-item" style="padding:12px;">
                    <div class="list-item-info">
                        <h4>👤 ${u.nama || u.username}</h4>
                        <p style="color:var(--text-muted);font-size:11px;">@${u.username} • <span style="color:${u.role==='admin'?'var(--accent-gold)':u.role==='operator'?'var(--accent-blue)':'var(--success)'};font-weight:bold;">${u.role.toUpperCase()}</span></p>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-sm btn-ghost" onclick="openEditUser('${u.username}')" title="Edit Nama/Password">✏️</button>
                        ${u.username !== 'admin' ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.username}')" title="Hapus">🗑️</button>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

async function addUser() {
    const username = sanitize(document.getElementById('newUsername').value);
    const fullName = sanitize(document.getElementById('newFullName').value);
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newRole').value;
    
    if (!username || !password) return toast('Username dan password wajib diisi', 'error');
    if (!fullName) return toast('Nama lengkap wajib diisi', 'error');
    
    const snap = await db.ref('users/' + username).once('value');
    if (snap.exists()) return toast('Username sudah digunakan', 'error');
    
    await db.ref('users/' + username).set({
        username: username,
        nama: fullName, // Simpan nama lengkap di sini
        password: hashPassword(password),
        role: role,
        createdAt: new Date().toISOString()
    });
    
    toast(`✅ User ${fullName} (${role}) berhasil ditambahkan`, 'success');
    document.getElementById('newUsername').value = '';
    document.getElementById('newFullName').value = '';
    document.getElementById('newPassword').value = '';
    renderUserList();
}

async function deleteUser(username) {
    if (!confirm(`Yakin ingin menghapus user ${username}?`)) return;
    await db.ref('users/' + username).remove();
    toast(`✅ User ${username} berhasil dihapus`, 'success');
    renderUserList();
}

// ==========================================
// EDIT USER FUNCTIONS
// ==========================================
let editingUsername = null;

function openEditUser(username) {
    editingUsername = username;
    db.ref('users/' + username).once('value').then(snap => {
        const u = snap.val();
        document.getElementById('editUsernameDisplay').textContent = username;
        document.getElementById('editFullName').value = u.nama || username;
        document.getElementById('editNewPassword').value = '';
        document.getElementById('editUserModal').classList.add('active');
    });
}

function closeEditUserModal() {
    document.getElementById('editUserModal').classList.remove('active');
    editingUsername = null;
}

async function saveEditUser() {
    if (!editingUsername) return;
    const fullName = sanitize(document.getElementById('editFullName').value);
    const newPassword = document.getElementById('editNewPassword').value;
    
    if (!fullName) return toast('Nama lengkap tidak boleh kosong', 'error');
    
    const updates = { nama: fullName };
    if (newPassword) {
        updates.password = hashPassword(newPassword);
    }
    
    await db.ref('users/' + editingUsername).update(updates);
    toast(`✅ Data ${fullName} berhasil diperbarui`, 'success');
    closeEditUserModal();
    renderUserList();
}

// ==========================================
// ROLE-BASED UI FILTERING
// ==========================================
function applyRoleUI() {
    if (!currentUser) return;
    
    // PASTIKAN ROLE VALID
    currentUser.role = (currentUser.role || 'member').toString().toLowerCase().trim();
    
    const role = currentUser.role;
    const nama = currentUser.nama || currentUser.username;
    console.log('🎨 applyRoleUI - role:', role, '| nama:', nama);
    
    // Update topbar
    document.getElementById('userName').textContent = nama;
    document.getElementById('userAvatar').textContent = nama[0].toUpperCase();
    document.getElementById('greetingText').textContent = `${greeting()}, ${nama}!`;
    document.getElementById('todayDate').textContent = formatTanggal(new Date());
    
    // Role badge
    const roleBadge = document.getElementById('userRoleBadge');
    roleBadge.textContent = role.toUpperCase();
    roleBadge.className = 'role-badge role-' + role;
    
    document.getElementById('userRole').textContent = role.toUpperCase();
    
    // Filter sidebar menu
    const sidebarItems = document.querySelectorAll('#sidebarMenu .nav-item');
    sidebarItems.forEach(item => {
        const rolesAttr = item.getAttribute('data-role');
        if (!rolesAttr) {
            item.style.display = 'flex';
            return;
        }
        
        const roles = rolesAttr.split(',').map(r => r.trim());
        if (roles.includes(role) || roles.includes('all')) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
    
    // Filter mobile nav
    const mobileItems = document.querySelectorAll('#mobileNav .mobile-nav-item');
    mobileItems.forEach(item => {
        const rolesAttr = item.getAttribute('data-role');
        if (!rolesAttr) {
            item.style.display = 'flex';
            return;
        }
        
        const roles = rolesAttr.split(',').map(r => r.trim());
        if (roles.includes(role) || roles.includes('all')) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
    
    // Set default page berdasarkan role
    let defaultPage = 'dashboard';
    if (role === 'member') defaultPage = 'memberPortal';
    
    // Tampilkan halaman default
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById('page-' + defaultPage);
    if (targetPage) targetPage.classList.add('active');
    
    document.getElementById('pageTitle').textContent = 
        defaultPage === 'dashboard' ? 'Dashboard' : 
        defaultPage === 'memberPortal' ? 'Portal Saya' : 'Dashboard';
    
    // Set active state
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.mobile-nav-item').forEach(n => n.classList.remove('active'));
    
    // Load data sesuai role
    if (role === 'member') {
        loadMemberPortal();
    } else if (role === 'admin') {
        refreshDashboard();
        renderUserList();
    } else {
        refreshDashboard();
    }
}

function checkRoleAccess(pageId) {
    // Debug log untuk troubleshooting
    console.log(' Check Access - pageId:', pageId, '| currentUser:', currentUser);
    
    if (!currentUser) {
        console.log(' currentUser is null/undefined');
        return false;
    }
    
    // Pastikan role terbaca dengan benar (case-insensitive & trim)
    const role = (currentUser.role || '').toString().toLowerCase().trim();
    
    console.log('📋 Role detected:', role);
    
    // Fallback jika role tidak dikenali
    if (!['admin', 'operator', 'member'].includes(role)) {
        console.log('⚠️ Role tidak dikenali, default ke member');
        toast('️ Role tidak dikenali, silakan login ulang', 'error');
        setTimeout(() => doLogout(), 2000);
        return false;
    }
    
    const roleAccess = {
        'admin': ['dashboard','masuk','keluar','scanner','daftarMember','dataMember','cetakKartu','topup','parkirAktif','history','laporan','setting','manageUsers'],
        'operator': ['dashboard','masuk','keluar','scanner','parkirAktif'],
        'member': ['memberPortal','memberKartu','memberRiwayat']
    };
    
    const allowed = roleAccess[role] || [];
    
    console.log('✅ Allowed pages:', allowed);
    
    if (!allowed.includes(pageId)) {
        const roleName = role === 'admin' ? 'Admin' : role === 'operator' ? 'Operator' : 'Member';
        toast(`⛔ Akses ditolak! Halaman ini hanya untuk ${roleName}`, 'error');
        
        setTimeout(() => {
            if (role === 'member') {
                showPage('memberPortal', null);
            } else {
                showPage('dashboard', null);
            }
        }, 1500);
        
        return false;
    }
    return true;
}

// ==========================================
// NAVIGATION
// ==========================================
function showPage(pageId, el) {
    if (!checkRoleAccess(pageId)) return;
    
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + pageId).classList.add('active');
    
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(n => n.classList.remove('active'));
    if (el) el.classList.add('active');
    
    const titles = {
        dashboard:'Dashboard',masuk:'Kendaraan Masuk',keluar:'Kendaraan Keluar',
        scanner:'Scan QR',daftarMember:'Daftar Member',dataMember:'Data Member',
        cetakKartu:'Cetak Kartu',topup:'Topup Saldo',parkirAktif:'Parkir Aktif',
        history:'History',laporan:'Laporan',setting:'Pengaturan',manageUsers:'Manage User',
        memberPortal:'Portal Saya',memberKartu:'Kartu Saya',memberRiwayat:'Riwayat Saya'
    };
    document.getElementById('pageTitle').textContent = titles[pageId] || 'Dashboard';
    
    if (pageId !== 'scanner' && scannerInstance) {
        try { scannerInstance.stop(); scannerInstance = null; } catch(e){}
    }
    
    if (pageId === 'dashboard') refreshDashboard();
    if (pageId === 'dataMember') renderMembers();
    if (pageId === 'cetakKartu') renderCetak();
    if (pageId === 'parkirAktif') renderParkirAktif();
    if (pageId === 'history') renderHistory();
    if (pageId === 'laporan') renderLaporan();
    if (pageId === 'setting') loadSetting();
    if (pageId === 'scanner') startScanner();
    if (pageId === 'daftarMember') loadHargaMember();
    if (pageId === 'memberPortal') loadMemberPortal();
    if (pageId === 'memberKartu') renderMemberKartu();
    if (pageId === 'memberRiwayat') renderMemberRiwayat();
    if (pageId === 'manageUsers' && currentUser.role === 'admin') renderUserList();
    
    if (window.innerWidth < 768) document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ==========================================
// DASHBOARD
// ==========================================
function refreshDashboard() {
    if (currentUser.role === 'member') return;
    
    db.ref('parkir_aktif').on('value', s => {
        const data = s.val() || {};
        document.getElementById('statAktif').textContent = Object.keys(data).length;
        renderRecentActivity(data);
    });
    db.ref('members').on('value', s => {
        const data = s.val() || {};
        document.getElementById('statMember').textContent = Object.keys(data).length;
    });
    
    const today = new Date().toISOString().split('T')[0];
    db.ref('history').orderByChild('waktu_keluar_date').equalTo(today).on('value', s => {
        const data = s.val() || {};
        const arr = Object.values(data);
        document.getElementById('statTransaksi').textContent = arr.length;
        const total = arr.reduce((a,b) => a + (b.total_biaya || 0), 0);
        document.getElementById('statPendapatan').textContent = formatRupiah(total);
    });
}

function renderRecentActivity(parkirData) {
    const box = document.getElementById('recentActivity');
    const arr = Object.values(parkirData).sort((a,b) => new Date(b.waktu_masuk) - new Date(a.waktu_masuk)).slice(0,3);
    if (arr.length === 0) {
        box.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">📭 Belum ada aktivitas</p>';
        return;
    }
    box.innerHTML = arr.map(h => {
        const badge = h.is_member ? '<span class="badge badge-member">MEMBER</span>' : '<span class="badge badge-reguler">REGULER</span>';
        return `<div class="list-item">
            <div class="list-item-info">
                <h4>${h.nama} ${badge}</h4>
                <p>${h.nomor_kendaraan} • ${h.waktu_masuk.substring(11,16)}</p>
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// MEMBER PORTAL
// ==========================================
async function loadMemberPortal() {
    if (!currentUser || currentUser.role !== 'member') return;
    
    const nik = currentUser.username;
    const snap = await db.ref('members').orderByChild('nik').equalTo(nik).once('value');
    
    if (!snap.exists()) {
        toast('Data member tidak ditemukan', 'error');
        return;
    }
    
    const member = Object.values(snap.val())[0];
    
    document.getElementById('mpNama').textContent = `Halo, ${member.nama}!`;
    document.getElementById('mpNo').textContent = member.nomor_member;
    document.getElementById('mpBerlaku').textContent = formatTanggalSingkat(member.tgl_berlaku);
    document.getElementById('mpSaldo').textContent = formatRupiah(member.saldo || 0);
    document.getElementById('mpStatus').textContent = (member.status || 'aktif').toUpperCase();
    document.getElementById('mpPlat').textContent = member.nomor_kendaraan;
    document.getElementById('mpJenis').textContent = (member.jenis_kendaraan || '-').toUpperCase();
    
    const thisMonth = new Date().toISOString().substring(0, 7);
    const historySnap = await db.ref('history').orderByChild('nik').equalTo(nik).once('value');
    const history = historySnap.val() ? Object.values(historySnap.val()) : [];
    const thisMonthHistory = history.filter(h => h.waktu_keluar && h.waktu_keluar.startsWith(thisMonth));
    
    const totalBulanIni = thisMonthHistory.reduce((a,b) => a + (b.total_biaya || 0), 0);
    
    document.getElementById('mpRingkasan').innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div style="background:rgba(0,229,160,0.08);padding:12px;border-radius:10px;">
                <p style="color:var(--text-muted);font-size:11px;">Total Parkir Bulan Ini</p>
                <p style="font-size:20px;font-weight:bold;color:var(--accent-teal);">${thisMonthHistory.length}x</p>
            </div>
            <div style="background:rgba(245,158,11,0.08);padding:12px;border-radius:10px;">
                <p style="color:var(--text-muted);font-size:11px;">Total Biaya Bulan Ini</p>
                <p style="font-size:20px;font-weight:bold;color:var(--accent-gold);">${formatRupiah(totalBulanIni)}</p>
            </div>
        </div>
    `;
}

async function renderMemberKartu() {
    if (!currentUser || currentUser.role !== 'member') return;
    
    const nik = currentUser.username;
    const snap = await db.ref('members').orderByChild('nik').equalTo(nik).once('value');
    
    if (!snap.exists()) {
        document.getElementById('memberKartuPreview').innerHTML = '<p style="color:var(--text-muted);text-align:center;">Data tidak ditemukan</p>';
        return;
    }
    
    const m = Object.values(snap.val())[0];
    
    document.getElementById('memberKartuPreview').innerHTML = `
        <div class="member-card-preview">
            <div class="card-header">
                <h3>🅿️ PARKIR PREMIUM</h3>
                <span>MEMBER CARD</span>
            </div>
            <div class="card-body">
                <div class="member-info">
                    <h4>${m.nama}</h4>
                    <div class="member-no">${m.nomor_member}</div>
                    <p>NIK: ${m.nik}</p>
                    <p>Kendaraan: ${m.nomor_kendaraan}</p>
                    <p>Jenis: ${m.jenis_kendaraan.toUpperCase()}</p>
                    <p style="color:var(--accent-gold);font-weight:bold;">Saldo: ${formatRupiah(m.saldo||0)}</p>
                    <p style="font-size:10px;opacity:0.7;">Berlaku: ${formatTanggalSingkat(m.tgl_berlaku)}</p>
                </div>
                <div id="qr-member"></div>
            </div>
        </div>
    `;
    
    setTimeout(() => {
        const el = document.getElementById('qr-member');
        if (el && !el.hasChildNodes()) {
            new QRCode(el, { text: m.nik, width: 100, height: 100, colorDark:'#000000', colorLight:'#ffffff' });
        }
    }, 100);
}

function cetakKartuSaya() {
    if (!currentUser || currentUser.role !== 'member') return;
    
    const nik = currentUser.username;
    db.ref('members').orderByChild('nik').equalTo(nik).once('value').then(snap => {
        if (!snap.exists()) return;
        const m = Object.values(snap.val())[0];
        cetakKartu(0, m.nomor_member, m.nama, m.nik, m.nomor_kendaraan, m.jenis_kendaraan, m.saldo||0, m.tgl_berlaku||'');
    });
}

async function renderMemberRiwayat() {
    if (!currentUser || currentUser.role !== 'member') return;
    
    const nik = currentUser.username;
    const snap = await db.ref('history').orderByChild('nik').equalTo(nik).once('value');
    const history = snap.val() ? Object.values(snap.val()).sort((a,b) => new Date(b.waktu_keluar) - new Date(a.waktu_keluar)) : [];
    
    const list = document.getElementById('memberRiwayatList');
    
    if (history.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">📭 Belum ada riwayat parkir</p>';
        return;
    }
    
    list.innerHTML = history.map(h => {
        return `<div class="list-item">
            <div class="list-item-info">
                <h4>${h.nomor_kendaraan} • ${h.jenis_kendaraan.toUpperCase()}</h4>
                <p>${h.waktu_masuk.substring(0,16)} → ${h.waktu_keluar.substring(0,16)}</p>
                <p style="font-size:11px;">${h.lama_jam} jam × ${formatRupiah(h.tarif_per_jam)}/jam</p>
            </div>
            <div style="text-align:right;">
                <p style="color:var(--success);font-weight:bold;font-size:14px;">${formatRupiah(h.total_biaya)}</p>
                ${h.diskon_persen > 0 ? `<p style="font-size:10px;color:var(--accent-teal);">Diskon ${h.diskon_persen}%</p>` : ''}
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// KENDARAAN MASUK
// ==========================================
async function cekMemberMasuk() {
    const nik = sanitize(document.getElementById('inNik').value);
    const info = document.getElementById('inInfo');
    if (!nik) { 
        info.style.display='block'; 
        info.style.background='rgba(245,158,11,0.15)'; 
        info.style.color='var(--accent-gold)'; 
        info.textContent='⚠ Masukkan NIK terlebih dahulu'; 
        return; 
    }
    
    const snap = await db.ref('members').orderByChild('nik').equalTo(nik).once('value');
    if (!snap.exists()) {
        selectedMember = null;
        info.style.display='block'; 
        info.style.background='rgba(239,68,68,0.15)'; 
        info.style.color='var(--danger)';
        info.textContent='❌ Bukan member — silakan isi data manual';
        return;
    }
    const m = Object.values(snap.val())[0];
    if (m.tgl_berlaku && new Date(m.tgl_berlaku) < new Date()) {
        selectedMember = null;
        info.style.display='block'; 
        info.style.background='rgba(245,158,11,0.15)'; 
        info.style.color='var(--accent-gold)';
        info.textContent='⚠️ Masa berlaku member habis! Perpanjang dulu.';
        return;
    }
    selectedMember = m;
    document.getElementById('inNama').value = m.nama;
    document.getElementById('inPlat').value = m.nomor_kendaraan;
    document.getElementById('inJenis').value = m.jenis_kendaraan;
    info.style.display='block'; 
    info.style.background='rgba(16,185,129,0.15)'; 
    info.style.color='var(--success)';
    info.innerHTML = `✅ <strong>MEMBER ${m.nomor_member}</strong> | Saldo ${formatRupiah(m.saldo)} | Diskon ${settings.diskon}%`;
}

async function prosesMasuk() {
    const nik = sanitize(document.getElementById('inNik').value);
    const nama = sanitize(document.getElementById('inNama').value);
    const plat = sanitize(document.getElementById('inPlat').value).toUpperCase();
    const jenis = document.getElementById('inJenis').value;
    
    if (!nik || !nama || !plat) return toast('NIK, Nama, dan Nomor Polisi wajib diisi','error');
    if (!jenis) return toast('Pilih jenis kendaraan','error');
    
    const cekSnap = await db.ref('parkir_aktif').orderByChild('nik').equalTo(nik).once('value');
    if (cekSnap.exists()) return toast('Kendaraan dengan NIK ini sudah parkir','error');
    
    const kode = 'PK' + new Date().toISOString().replace(/[-:T]/g,'').substring(0,14) + nik.substring(nik.length-4);
    const now = new Date().toISOString();
    
    const data = {
        nik, nama, nomor_kendaraan: plat, jenis_kendaraan: jenis,
        waktu_masuk: now, kode_tiket: kode,
        is_member: !!selectedMember, nomor_member: selectedMember?.nomor_member || '',
        operator_masuk: currentUser.username
    };
    
    await db.ref('parkir_aktif').push(data);
    
    const tarif = selectedMember ? Math.round(settings['tarif_'+jenis] * (100-settings.diskon)/100) : settings['tarif_'+jenis];
    let html = `<div style="text-align:center;padding:10px;">
        <h2 style="color:var(--accent-teal);margin-bottom:10px;">🎫 KARTU PARKIR</h2>
        <hr style="border-color:var(--border);margin:12px 0;">
        <p><strong>Nama:</strong> ${nama}</p>
        <p><strong>Kendaraan:</strong> ${plat}</p>
        <p><strong>Jenis:</strong> ${jenis.toUpperCase()}</p>
        <p><strong>Waktu Masuk:</strong> ${new Date(now).toLocaleString('id-ID')}</p>`;
    if (selectedMember) {
        html += `<p style="color:var(--success);margin-top:10px;">🎖️ MEMBER | Diskon ${settings.diskon}% | Tarif ${formatRupiah(tarif)}/jam</p>`;
    }
    html += `<hr style="border-color:var(--border);margin:12px 0;">
        <h1 style="color:var(--accent-teal);font-size:24px;margin:10px 0;">${kode}</h1>
        <p style="color:var(--text-secondary);font-size:12px;">Tunjukkan kode ini saat keluar</p>
    </div>`;
    showModal('Kartu Parkir', html);
    
    ['inNik','inNama','inPlat'].forEach(id => document.getElementById(id).value='');
    document.getElementById('inJenis').value = '';
    document.getElementById('inInfo').style.display = 'none';
    selectedMember = null;
    navigator.clipboard.writeText(kode).catch(()=>{});
}

// ==========================================
// KENDARAAN KELUAR
// ==========================================
async function prosesKeluar() {
    const kode = sanitize(document.getElementById('outKode').value).toUpperCase();
    if (!kode) return toast('Masukkan kode tiket','error');
    await doKeluar(kode);
    document.getElementById('outKode').value = '';
}

async function doKeluar(kode) {
    const snap = await db.ref('parkir_aktif').orderByChild('kode_tiket').equalTo(kode).once('value');
    if (!snap.exists()) return toast('Kode tiket tidak ditemukan','error');
    
    const key = Object.keys(snap.val())[0];
    const data = snap.val()[key];
    
    let tMasuk = new Date(data.waktu_masuk);
    if (isNaN(tMasuk.getTime())) tMasuk = new Date(data.waktu_masuk.replace(' ', 'T'));
    if (isNaN(tMasuk.getTime())) tMasuk = new Date(data.waktu_masuk.replace(' ', 'T') + 'Z');
    
    const tKeluar = new Date();
    const diffMs = tKeluar - tMasuk;
    const diffHours = diffMs / 3600000;
    let jam = Math.ceil(diffHours);
    if (jam < 1) jam = 1;
    
    const tarifDasar = settings['tarif_' + data.jenis_kendaraan] || 1000;
    let diskonPersen = 0;
    let tarifAkhir = tarifDasar;
    let potongan = 0;
    
    if (data.is_member) {
        diskonPersen = settings.diskon || 0;
        potongan = Math.round(tarifDasar * (diskonPersen / 100));
        tarifAkhir = tarifDasar - potongan;
    }
    
    const biaya = jam * tarifAkhir;
    
    let saldoAkhir = null;
    if (data.is_member && data.nomor_member) {
        const mSnap = await db.ref('members').orderByChild('nomor_member').equalTo(data.nomor_member).once('value');
        if (mSnap.exists()) {
            const mKey = Object.keys(mSnap.val())[0];
            const member = mSnap.val()[mKey];
            if (member.saldo < biaya) {
                return toast(`Saldo member tidak cukup! Biaya ${formatRupiah(biaya)}, saldo ${formatRupiah(member.saldo)}`, 'error');
            }
            saldoAkhir = member.saldo - biaya;
            await db.ref('members/' + mKey + '/saldo').set(saldoAkhir);
        }
    }
    
    const historyData = {
        ...data,
        waktu_keluar: tKeluar.toISOString(),
        waktu_keluar_date: tKeluar.toISOString().split('T')[0],
        lama_jam: jam, 
        tarif_per_jam: tarifAkhir, 
        diskon_persen: diskonPersen,
        total_biaya: biaya, 
        operator_keluar: currentUser.username,
        saldo_akhir: saldoAkhir
    };
    await db.ref('history').push(historyData);
    await db.ref('parkir_aktif/' + key).remove();
    
    const tag = data.is_member ? '🏅 MEMBER' : '👤 REGULER';
    const accent = data.is_member ? 'var(--success)' : 'var(--accent-gold)';
    
    let struk = `
    <div id="struk-content" class="struk" style="background:white;color:black;padding:24px;border-radius:12px;font-family:'Courier New',monospace;max-width:400px;margin:0 auto;">
        <div style="text-align:center;border-bottom:2px dashed #ccc;padding-bottom:12px;margin-bottom:12px;">
            <h3 style="font-size:18px;margin:0;">🧾 STRUK — ${tag}</h3>
            <p style="font-size:11px;margin:4px 0 0 0;">PARKIR PREMIUM</p>
            <p style="font-size:10px;margin:2px 0;">Kabupaten Ende</p>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span>Nama</span><span>${data.nama}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span>Kendaraan</span><span>${data.nomor_kendaraan}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span>Jenis</span><span>${data.jenis_kendaraan.toUpperCase()}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span>Masuk</span><span>${tMasuk.toLocaleString('id-ID')}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span>Keluar</span><span>${tKeluar.toLocaleString('id-ID')}</span></div>
        <div style="display:flex;justify-content:space-between;padding:8px;font-size:14px;font-weight:bold;background:#f0f0f0;margin:8px 0;border-radius:4px;"><span>Lama Parkir</span><span>${jam} Jam</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;"><span>Tarif Dasar</span><span>${formatRupiah(tarifDasar)}/jam</span></div>
        ${diskonPersen > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:green;"><span>Diskon Member (${diskonPersen}%)</span><span>- ${formatRupiah(potongan)}</span></div>` : '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:gray;"><span>Diskon</span><span>Tidak Ada (Reguler)</span></div>'}
        ${diskonPersen > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;font-weight:bold;"><span>Tarif Akhir</span><span>${formatRupiah(tarifAkhir)}/jam</span></div>` : ''}
        <div style="border-top:2px dashed #ccc;margin-top:12px;padding-top:12px;font-weight:bold;font-size:18px;display:flex;justify-content:space-between;">
            <span>TOTAL BAYAR</span>
            <span style="color:${accent};">${formatRupiah(biaya)}</span>
        </div>
        ${saldoAkhir !== null ? `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;margin-top:8px;"><span>Sisa Saldo</span><span style="color:blue;font-weight:bold;">${formatRupiah(saldoAkhir)}</span></div>` : ''}
        <div style="margin-top:16px;padding:12px;background:#f9f9f9;border-radius:8px;font-size:11px;color:#666;">
            <strong>Keterangan:</strong><br>
            ${jam} jam × ${formatRupiah(tarifAkhir)} = ${formatRupiah(biaya)}
        </div>
        <div style="text-align:center;margin-top:16px;padding-top:12px;border-top:1px dashed #ccc;color:#666;font-size:12px;">
            Terima kasih 🙏<br>
            www.parkirpremium.id
        </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:20px;">
        <button onclick="cetakStruk()" class="btn btn-primary" style="flex:1;padding:12px;background:var(--accent-teal);color:var(--bg-dark);border:none;border-radius:8px;font-weight:bold;cursor:pointer;">
            🖨️ Cetak Struk
        </button>
        <button onclick="closeModal()" class="btn btn-ghost" style="flex:1;padding:12px;background:transparent;border:1.5px solid var(--accent-teal);color:var(--accent-teal);border-radius:8px;font-weight:bold;cursor:pointer;">
            Tutup
        </button>
    </div>`;
    
    showModal('Struk Parkir', struk);
}

function cetakStruk() {
    const strukContent = document.getElementById('struk-content');
    if (!strukContent) return;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Struk Parkir</title>
            <style>
                body { font-family: 'Courier New', monospace; max-width: 400px; margin: 0 auto; padding: 20px; }
                @media print { body { margin: 0; padding: 10px; } }
            </style>
        </head>
        <body>
            ${strukContent.innerHTML}
            <script>
                window.onload = function() { window.print(); setTimeout(() => window.close(), 500); }
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// ==========================================
// SCANNER
// ==========================================
function startScanner() {
    if (scannerInstance) return;
    scannerInstance = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    scannerInstance.start({ facingMode: "environment" }, config,
        async (text) => {
            document.getElementById('scanStatus').textContent = '✅ Terdeteksi: ' + text;
            document.getElementById('scanStatus').style.color = 'var(--accent-teal)';
            try { scannerInstance.stop(); scannerInstance = null; } catch(e){}
            
            const memberSnap = await db.ref('members').orderByChild('nik').equalTo(text).once('value');
            if (memberSnap.exists()) {
                const m = Object.values(memberSnap.val())[0];
                document.getElementById('inNik').value = m.nik;
                document.getElementById('inNama').value = m.nama;
                document.getElementById('inPlat').value = m.nomor_kendaraan;
                document.getElementById('inJenis').value = m.jenis_kendaraan;
                selectedMember = m;
                showPage('masuk', document.querySelector('[onclick*="masuk"]'));
                toast('Member terdeteksi! Silakan proses masuk', 'success');
            } else {
                await doKeluar(text.toUpperCase());
            }
        },
        (err) => {}
    ).catch(err => {
        document.getElementById('scanStatus').textContent = '❌ Kamera error: ' + err;
        document.getElementById('scanStatus').style.color = 'var(--danger)';
    });
}

async function prosesScanManual() {
    const val = sanitize(document.getElementById('scanManual').value).toUpperCase();
    if (!val) return toast('Masukkan kode','error');
    document.getElementById('scanManual').value = '';
    
    const memberSnap = await db.ref('members').orderByChild('nik').equalTo(val).once('value');
    if (memberSnap.exists()) {
        const m = Object.values(memberSnap.val())[0];
        document.getElementById('inNik').value = m.nik;
        document.getElementById('inNama').value = m.nama;
        document.getElementById('inPlat').value = m.nomor_kendaraan;
        document.getElementById('inJenis').value = m.jenis_kendaraan;
        selectedMember = m;
        showPage('masuk', document.querySelector('[onclick*="masuk"]'));
        toast('Member terdeteksi!', 'success');
    } else {
        await doKeluar(val);
    }
}

// ==========================================
// DAFTAR MEMBER
// ==========================================
function loadHargaMember() {
    document.getElementById('hargaMotor').textContent = formatRupiah(settings.biaya_motor || 30000) + '/bulan';
    document.getElementById('hargaMobil').textContent = formatRupiah(settings.biaya_mobil || 90000) + '/bulan';
}

async function daftarMember() {
    const nik = sanitize(document.getElementById('dmNik').value);
    const nama = sanitize(document.getElementById('dmNama').value);
    const alamat = sanitize(document.getElementById('dmAlamat').value);
    const telp = sanitize(document.getElementById('dmTelp').value);
    const plat = sanitize(document.getElementById('dmPlat').value).toUpperCase();
    const jenis = document.getElementById('dmJenis').value;
    
    if (!nik || !nama || !plat) return toast('NIK, Nama, dan Nomor Polisi wajib diisi','error');
    if (!isValidNIK(nik)) return toast('NIK harus 10-20 digit angka','error');
    if (!jenis) return toast('Pilih jenis kendaraan','error');
    
    const cek = await db.ref('members').orderByChild('nik').equalTo(nik).once('value');
    if (cek.exists()) return toast('NIK sudah terdaftar sebagai member','error');
    
    const nomor_member = genMemberNo();
    const biaya = settings['biaya_' + jenis] || (jenis === 'motor' ? 30000 : 90000);
    const berlaku = new Date(Date.now() + 30*24*60*60*1000).toISOString().replace('T',' ').substring(0,19);
    
    const data = {
        nik, nama, alamat, no_telepon: telp,
        jenis_kendaraan: jenis, nomor_kendaraan: plat,
        nomor_member, saldo: biaya, status: 'aktif',
        tgl_daftar: new Date().toISOString().replace('T',' ').substring(0,19),
        tgl_berlaku: berlaku
    };
    
    await db.ref('members').push(data);
    
    // Auto-create user untuk member
    await db.ref('users/' + nik).set({
        username: nik,
        password: hashPassword(nik),
        role: 'member',
        nama: nama,
        createdAt: new Date().toISOString()
    });
    
    showModal('Pendaftaran Berhasil', `
        <div style="text-align:center;padding:10px;">
            <h2 style="color:var(--success);margin-bottom:16px;">✅ PENDAFTARAN BERHASIL</h2>
            <hr style="border-color:var(--border);margin:12px 0;">
            <p><strong>Nomor Member:</strong> <span style="color:var(--accent-teal);font-size:18px;">${nomor_member}</span></p>
            <p><strong>Nama:</strong> ${nama}</p>
            <p><strong>Jenis:</strong> ${jenis.toUpperCase()}</p>
            <hr style="border-color:var(--border);margin:12px 0;">
            <p><strong>Biaya Daftar:</strong> ${formatRupiah(biaya)}</p>
            <p style="color:var(--success);"><strong>Saldo Awal:</strong> ${formatRupiah(biaya)}</p>
            <hr style="border-color:var(--border);margin:12px 0;">
            <p style="color:var(--accent-gold);font-weight:bold;"> Info Login Member:</p>
            <p>Username: <strong>${nik}</strong></p>
            <p>Password: <strong>${nik}</strong></p>
            <p style="color:var(--text-secondary);font-size:11px;margin-top:8px;">Sarankan member mengganti password setelah login pertama</p>
        </div>
    `);
    
    ['dmNik','dmNama','dmAlamat','dmTelp','dmPlat'].forEach(id => document.getElementById(id).value='');
    document.getElementById('dmJenis').value = '';
}

// ==========================================
// DATA MEMBER
// ==========================================
async function renderMembers() {
    const snap = await db.ref('members').once('value');
    const all = snap.val() ? Object.values(snap.val()) : [];
    const q = (document.getElementById('searchMember')?.value || '').toLowerCase();
    const filtered = all.filter(m => 
        m.nama.toLowerCase().includes(q) || 
        m.nik.includes(q) || 
        m.nomor_member.toLowerCase().includes(q)
    );
    
    const totalSaldo = filtered.reduce((a,b) => a + (b.saldo||0), 0);
    document.getElementById('memberStats').innerHTML = 
        ` Total <strong>${filtered.length}</strong> member | 💰 Saldo gabungan <strong>${formatRupiah(totalSaldo)}</strong>`;
    
    const list = document.getElementById('memberList');
    if (filtered.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">👥 Belum ada member</p>';
        return;
    }
    
    list.innerHTML = filtered.map(m => {
        const statusCol = m.status === 'aktif' ? 'var(--success)' : 'var(--danger)';
        return `<div class="list-item">
            <div class="list-item-info">
                <h4>📇 ${m.nama}</h4>
                <p style="color:var(--accent-teal);">${m.nomor_member}</p>
                <p>${m.nomor_kendaraan} | <span class="badge badge-${m.jenis_kendaraan}">${m.jenis_kendaraan.toUpperCase()}</span></p>
                <p style="color:var(--success);font-weight:bold;">💰 Saldo: ${formatRupiah(m.saldo||0)}</p>
                <p><span style="color:${statusCol};font-weight:bold;">${m.status.toUpperCase()}</span> • Berlaku s/d ${formatTanggalSingkat(m.tgl_berlaku)}</p>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
                <button class="btn btn-ghost btn-sm" onclick="showDetailMember('${m.nik}')" title="Detail">👁️</button>
                <button class="btn btn-danger btn-sm" onclick="hapusMember('${m.nik}', '${m.nama.replace(/'/g, "\\'")}')" title="Hapus">🗑️</button>
            </div>
        </div>`;
    }).join('');
}

async function exportMemberCSV() {
    const snap = await db.ref('members').once('value');
    const data = snap.val() ? Object.values(snap.val()) : [];
    if (data.length === 0) return toast('Tidak ada data','error');
    
    let csv = 'No Member,NIK,Nama,Alamat,Telepon,Jenis,Nopol,Saldo,Status,Daftar,Berlaku\n';
    data.forEach(m => {
        csv += `"${m.nomor_member}","${m.nik}","${m.nama}","${m.alamat||''}","${m.no_telepon||''}","${m.jenis_kendaraan}","${m.nomor_kendaraan}",${m.saldo||0},"${m.status}","${m.tgl_daftar||''}","${m.tgl_berlaku||''}"\n`;
    });
    
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'member_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    toast('Export berhasil','success');
}

async function hapusMember(nik, nama) {
    if (!confirm(`⚠️ PERINGATAN!\n\nAnda akan menghapus member:\n\nNama: ${nama}\nNIK: ${nik}\n\nData yang dihapus TIDAK BISA dikembalikan!\n\nLanjutkan?`)) return;
    if (!confirm(`Yakin 100% ingin hapus ${nama}?`)) return;
    
    try {
        const snap = await db.ref('members').orderByChild('nik').equalTo(nik).once('value');
        if (!snap.exists()) return toast('Member tidak ditemukan', 'error');
        
        const key = Object.keys(snap.val())[0];
        await db.ref('members/' + key).remove();
        await db.ref('users/' + nik).remove();
        
        toast(`✅ Member ${nama} berhasil dihapus!`, 'success');
        renderMembers();
    } catch (err) {
        toast(' Gagal hapus: ' + err.message, 'error');
    }
}

async function showDetailMember(nik) {
    const snap = await db.ref('members').orderByChild('nik').equalTo(nik).once('value');
    if (!snap.exists()) return;
    const m = Object.values(snap.val())[0];
    showModal('Detail Member', `
        <div style="padding:10px;">
            <h3 style="color:var(--accent-teal);">${m.nama}</h3>
            <p style="color:var(--accent-teal);margin-bottom:12px;">${m.nomor_member}</p>
            <hr style="border-color:var(--border);margin:12px 0;">
            <p><strong>NIK:</strong> ${m.nik}</p>
            <p><strong>Telepon:</strong> ${m.no_telepon||'-'}</p>
            <p><strong>Alamat:</strong> ${m.alamat||'-'}</p>
            <p><strong>Kendaraan:</strong> ${m.nomor_kendaraan} (${m.jenis_kendaraan.toUpperCase()})</p>
            <p><strong>Saldo:</strong> <span style="color:var(--success);font-weight:bold;">${formatRupiah(m.saldo||0)}</span></p>
            <p><strong>Status:</strong> <span style="color:${m.status==='aktif'?'var(--success)':'var(--danger)'};">${m.status.toUpperCase()}</span></p>
            <p><strong>Daftar:</strong> ${m.tgl_daftar||'-'}</p>
            <p><strong>Berlaku s/d:</strong> ${formatTanggalSingkat(m.tgl_berlaku)}</p>
        </div>
    `);
}

// ==========================================
// CETAK KARTU
// ==========================================
async function renderCetak() {
    const snap = await db.ref('members').once('value');
    const all = snap.val() ? Object.values(snap.val()) : [];
    const q = (document.getElementById('searchCetak')?.value || '').toLowerCase();
    const filtered = all.filter(m => 
        m.nama.toLowerCase().includes(q) || 
        m.nik.includes(q) || 
        m.nomor_member.toLowerCase().includes(q)
    );
    
    const list = document.getElementById('cetakList');
    if (filtered.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">Tidak ditemukan</p>';
        return;
    }
    
    list.innerHTML = filtered.map((m, i) => `
        <div class="card" style="margin-bottom:16px;">
            <div class="member-card-preview print-area">
                <div class="card-header">
                    <h3>️ PARKIR PREMIUM</h3>
                    <span>MEMBER CARD</span>
                </div>
                <div class="card-body">
                    <div class="member-info">
                        <h4>${m.nama}</h4>
                        <div class="member-no">${m.nomor_member}</div>
                        <p>NIK: ${m.nik}</p>
                        <p>Kendaraan: ${m.nomor_kendaraan}</p>
                        <p>Jenis: ${m.jenis_kendaraan.toUpperCase()}</p>
                        <p style="color:var(--accent-gold);font-weight:bold;">Saldo: ${formatRupiah(m.saldo||0)}</p>
                        <p style="font-size:10px;opacity:0.7;">Berlaku: ${formatTanggalSingkat(m.tgl_berlaku)}</p>
                    </div>
                    <div id="qr-${i}"></div>
                </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
                <button class="btn btn-purple btn-sm" onclick="cetakKartu(${i},'${m.nomor_member}','${m.nama}','${m.nik}','${m.nomor_kendaraan}','${m.jenis_kendaraan}',${m.saldo||0},'${m.tgl_berlaku||''}')">🖨️ Cetak</button>
                <button class="btn btn-ghost btn-sm" onclick="showDetailMember('${m.nik}')">️ Detail</button>
            </div>
        </div>
    `).join('');
    
    setTimeout(() => {
        filtered.forEach((m, i) => {
            const el = document.getElementById('qr-' + i);
            if (el && !el.hasChildNodes()) {
                new QRCode(el, { text: m.nik, width: 100, height: 100, colorDark:'#000000', colorLight:'#ffffff' });
            }
        });
    }, 100);
}

function cetakKartu(i, no, nama, nik, plat, jenis, saldo, berlaku) {
    const win = window.open('', '_blank');
    win.document.write(`
        <html><head><title>Kartu Member - ${nama}</title>
        <style>
            body{font-family:Arial;margin:20px;}
            .card{background:linear-gradient(135deg,#1a237e,#0d47a1);color:white;padding:24px;border-radius:16px;max-width:400px;margin:0 auto;border:2px solid #00e5a0;}
            .header{display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,0.2);padding-bottom:10px;margin-bottom:12px;}
            .header h2{color:#ffd700;margin:0;}
            .body{display:flex;gap:16px;}
            .info h3{margin:0 0 4px 0;font-size:18px;}
            .info .no{color:#00e5a0;font-size:12px;margin-bottom:10px;}
            .info p{font-size:11px;margin:3px 0;}
            .footer{display:flex;justify-content:space-between;margin-top:12px;font-size:10px;opacity:0.7;}
            @media print{body{margin:0;}}
        </style></head><body>
        <div class="card">
            <div class="header"><h2>🅿️ PARKIR PREMIUM</h2><span>MEMBER CARD</span></div>
            <div class="body">
                <div class="info">
                    <h3>${nama}</h3>
                    <div class="no">${no}</div>
                    <p>NIK: ${nik}</p>
                    <p>Kendaraan: ${plat}</p>
                    <p>Jenis: ${jenis.toUpperCase()}</p>
                    <p style="color:#ffd700;font-weight:bold;">Saldo: ${formatRupiah(saldo)}</p>
                    <p style="font-size:10px;">Berlaku: ${formatTanggalSingkat(berlaku)}</p>
                </div>
                <div id="qr"></div>
            </div>
            <div class="footer"><span>Daftar: ${formatTanggalSingkat(new Date().toISOString())}</span><span>www.parkirpremium.id</span></div>
        </div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
        <script>new QRCode(document.getElementById('qr'),{text:'${nik}',width:100,height:100});setTimeout(()=>window.print(),500);<\/script>
        </body></html>
    `);
    win.document.close();
}

// ==========================================
// TOPUP
// ==========================================
async function cariMemberTopup() {
    const q = sanitize(document.getElementById('topupSearch').value);
    if (!q) return toast('Masukkan NIK atau Nomor Member','error');
    
    let snap = await db.ref('members').orderByChild('nik').equalTo(q).once('value');
    if (!snap.exists()) snap = await db.ref('members').orderByChild('nomor_member').equalTo(q).once('value');
    if (!snap.exists()) return toast('Member tidak ditemukan','error');
    
    selectedMember = Object.values(snap.val())[0];
    document.getElementById('topupInfo').style.display = 'block';
    document.getElementById('topupInfo').innerHTML = `
        <div class="list-item">
            <div class="list-item-info">
                <h4>👤 ${selectedMember.nama}</h4>
                <p style="color:var(--accent-teal);">${selectedMember.nomor_member}</p>
                <p>${selectedMember.nomor_kendaraan} | ${selectedMember.jenis_kendaraan.toUpperCase()}</p>
                <p style="color:var(--success);font-weight:bold;">💰 Saldo: ${formatRupiah(selectedMember.saldo||0)}</p>
                <p style="font-size:11px;">Berlaku s/d ${formatTanggalSingkat(selectedMember.tgl_berlaku)}</p>
            </div>
        </div>
    `;
    document.getElementById('topupNominal').style.display = 'block';
}

async function prosesTopup(jumlah) {
    if (isTopupProcessing) return;
    if (!selectedMember) return toast('Cari member dulu','error');

    isTopupProcessing = true;
    const btns = document.querySelectorAll('#topupNominal .btn');
    btns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

    try {
        const snap = await db.ref('members').orderByChild('nomor_member').equalTo(selectedMember.nomor_member).once('value');
        if (!snap.exists()) return toast('Member tidak ditemukan','error');
        const key = Object.keys(snap.val())[0];
        const member = snap.val()[key];
        
        const saldoBaru = (member.saldo || 0) + jumlah;
        const berlakuBaru = new Date(Date.now() + 30*24*60*60*1000).toISOString().replace('T',' ').substring(0,19);
        
        await db.ref('members/' + key).update({ saldo: saldoBaru, tgl_berlaku: berlakuBaru });
        
        showModal('Topup Berhasil', `
            <div style="text-align:center;padding:20px;">
                <h2 style="color:var(--success);">✅ TOPUP BERHASIL</h2>
                <p style="margin:16px 0;">Nominal: <strong style="color:var(--accent-gold);">${formatRupiah(jumlah)}</strong></p>
                <p>Saldo Baru: <strong style="color:var(--success);font-size:20px;">${formatRupiah(saldoBaru)}</strong></p>
                <p style="margin-top:10px;color:var(--text-secondary);font-size:12px;">Masa berlaku diperpanjang sampai ${formatTanggalSingkat(berlakuBaru)}</p>
            </div>
        `);
        
        selectedMember = null;
        document.getElementById('topupSearch').value = '';
        document.getElementById('topupInfo').style.display = 'none';
        document.getElementById('topupNominal').style.display = 'none';
    } catch (err) {
        toast('Gagal topup: ' + err.message, 'error');
    } finally {
        isTopupProcessing = false;
        btns.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
    }
}

// ==========================================
// PARKIR AKTIF
// ==========================================
async function renderParkirAktif() {
    const snap = await db.ref('parkir_aktif').once('value');
    const data = snap.val() ? Object.values(snap.val()) : [];
    const list = document.getElementById('parkirAktifList');
    
    if (data.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">📭 Tidak ada kendaraan parkir</p>';
        return;
    }
    
    list.innerHTML = `<p style="color:var(--accent-teal);font-size:12px;margin-bottom:12px;">Total: <strong>${data.length}</strong> kendaraan</p>` +
        data.map(d => {
            const tag = d.is_member ? '<span class="badge badge-member">️ MEMBER</span>' : '<span class="badge badge-reguler">👤 REGULER</span>';
            return `<div class="list-item">
                <div class="list-item-info">
                    <h4>${d.nama} ${tag}</h4>
                    <p>Plat: ${d.nomor_kendaraan}</p>
                    <p>Jenis: ${d.jenis_kendaraan.toUpperCase()} • Masuk: ${d.waktu_masuk.substring(5,16)}</p>
                    <p style="color:var(--text-muted);font-size:11px;">${d.kode_tiket}</p>
                </div>
                <button class="btn btn-danger btn-sm" onclick="doKeluar('${d.kode_tiket}')">Keluar</button>
            </div>`;
        }).join('');
}

// ==========================================
// HISTORY
// ==========================================
async function renderHistory() {
    const snap = await db.ref('history').limitToLast(80).once('value');
    const data = snap.val() ? Object.values(snap.val()).sort((a,b) => new Date(b.waktu_keluar) - new Date(a.waktu_keluar)) : [];
    
    const total = data.reduce((a,b) => a + (b.total_biaya||0), 0);
    const nMember = data.filter(h => h.is_member).length;
    document.getElementById('historyStats').innerHTML = 
        ` <strong>${data.length}</strong> transaksi | 💰 Total <strong>${formatRupiah(total)}</strong> | 🎖️ Member ${nMember} | 👤 Reguler ${data.length-nMember}`;
    
    const list = document.getElementById('historyList');
    if (data.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">📭 Belum ada history</p>';
        return;
    }
    
    list.innerHTML = data.map(h => {
        const col = h.is_member ? 'var(--success)' : 'var(--accent-gold)';
        return `<div class="list-item">
            <div class="list-item-info">
                <h4 style="color:${col};">${h.is_member?'🎖️':''} ${h.nama}</h4>
                <p>${h.nomor_kendaraan} | ${h.jenis_kendaraan.toUpperCase()} | ${h.lama_jam} jam</p>
                <p style="font-size:11px;color:var(--text-muted);">Masuk ${h.waktu_masuk.substring(5,16)} → Keluar ${h.waktu_keluar.substring(11,16)}</p>
                <p style="color:${col};font-weight:bold;font-size:14px;">${formatRupiah(h.total_biaya)}</p>
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// LAPORAN
// ==========================================
async function renderLaporan() {
    const filter = document.getElementById('laporanFilter').value;
    let snap;
    if (filter === 'today') {
        const today = new Date().toISOString().split('T')[0];
        snap = await db.ref('history').orderByChild('waktu_keluar_date').equalTo(today).once('value');
    } else {
        snap = await db.ref('history').limitToLast(200).once('value');
    }
    const data = snap.val() ? Object.values(snap.val()) : [];
    
    const total = data.reduce((a,b) => a + (b.total_biaya||0), 0);
    const motor = data.filter(h => h.jenis_kendaraan === 'motor').length;
    const mobil = data.filter(h => h.jenis_kendaraan === 'mobil').length;
    const member = data.filter(h => h.is_member).length;
    
    document.getElementById('laporanStats').innerHTML = `
        <p style="margin-bottom:8px;">📊 <strong>${data.length}</strong> kendaraan</p>
        <p style="margin-bottom:8px;">🏍️ Motor ${motor} | 🚙 Mobil ${mobil}</p>
        <p style="margin-bottom:8px;">️ Member ${member} | 👤 Reguler ${data.length-member}</p>
        <p style="color:var(--accent-gold);font-weight:bold;font-size:16px;">💰 Pendapatan: ${formatRupiah(total)}</p>
    `;
    
    const list = document.getElementById('laporanList');
    list.innerHTML = data.slice(0,30).map(h => {
        const col = h.is_member ? 'var(--success)' : 'var(--accent-gold)';
        return `<div class="list-item" style="padding:10px;">
            <span style="width:10%;">${h.is_member?'🎖️':'👤'}</span>
            <span style="width:30%;font-size:12px;">${h.nama.substring(0,14)}</span>
            <span style="width:25%;font-size:11px;color:var(--text-secondary);">${h.nomor_kendaraan}</span>
            <span style="width:35%;text-align:right;color:${col};font-weight:bold;font-size:13px;">${formatRupiah(h.total_biaya)}</span>
        </div>`;
    }).join('');
}

async function exportLaporanCSV() {
    const snap = await db.ref('history').limitToLast(3000).once('value');
    const data = snap.val() ? Object.values(snap.val()) : [];
    if (data.length === 0) return toast('Tidak ada data','error');
    
    let csv = 'No,NIK,Nama,Nopol,Jenis,Masuk,Keluar,Jam,Tarif,Diskon%,Total,Member,Op Masuk,Op Keluar\n';
    data.forEach((h,i) => {
        csv += `${i+1},"${h.nik}","${h.nama}","${h.nomor_kendaraan}","${h.jenis_kendaraan}","${h.waktu_masuk}","${h.waktu_keluar}",${h.lama_jam},${h.tarif_per_jam},${h.diskon_persen||0},${h.total_biaya},"${h.is_member?'Ya':'Tidak'}","${h.operator_masuk||''}","${h.operator_keluar||''}"\n`;
    });
    
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'laporan_' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    toast('Export berhasil','success');
}

// ==========================================
// SETTING
// ==========================================
async function loadSetting() {
    const snap = await db.ref('settings').once('value');
    if (snap.exists()) {
        settings = snap.val();
        document.getElementById('setMotor').value = settings.tarif_motor || 1000;
        document.getElementById('setMobil').value = settings.tarif_mobil || 3000;
        document.getElementById('setDiskon').value = settings.diskon || 10;
    }
}

async function simpanSetting() {
    const tm = parseInt(document.getElementById('setMotor').value);
    const tb = parseInt(document.getElementById('setMobil').value);
    const d = parseInt(document.getElementById('setDiskon').value);
    
    if (isNaN(tm) || isNaN(tb) || tm < 500 || tb < 500) return toast('Tarif minimal Rp 500','error');
    if (isNaN(d) || d < 0 || d > 100) return toast('Diskon antara 0-100%','error');
    
    await db.ref('settings').update({ tarif_motor: tm, tarif_mobil: tb, diskon: d });
    settings = { ...settings, tarif_motor: tm, tarif_mobil: tb, diskon: d };
    toast('Pengaturan berhasil disimpan!','success');
}

// ==========================================
// CLOCK & INIT
// ==========================================
function updateClock() {
    const now = new Date();
    document.getElementById('clock').textContent = '🕐 ' + now.toLocaleTimeString('id-ID');
}

async function initApp() {
    await initDefaultSettings();
    if (currentUser && currentUser.role !== 'member') {
        refreshDashboard();
        if (currentUser.role === 'admin') {
            renderUserList();
        }
    } else if (currentUser && currentUser.role === 'member') {
        loadMemberPortal();
    }
}

document.getElementById('loginPass').addEventListener('keypress', e => {
    if (e.key === 'Enter') doLogin();
});

setInterval(updateClock, 1000);
updateClock();

initDefaultUsers();

window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (!checkAuth()) {
            console.log('ℹ️ Silakan login');
        }
    }, 500);
});

document.getElementById('modal').addEventListener('click', e => {
    if (e.target.id === 'modal') closeModal();
});
