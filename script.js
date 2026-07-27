(function(){
  const DB_PATH = 'troopTrackerData';

  function defaultData(){
    return {
      groups: [
        {id:'g1', name:'Group 1', members:[]},
        {id:'g2', name:'Group 2', members:[]},
        {id:'g3', name:'Group 3', members:[]},
        {id:'g4', name:'Group 4', members:[]}
      ],
      attendance: [] // {date, records: {memberId: 'present'|'late'|'absent'}}
    };
  }

  let data = defaultData();
  let dbRef = null;
  let firstLoadHandled = false;

  function saveData(){
    if(!dbRef){
      console.warn('Not connected yet — change was not saved.');
      return;
    }
    dbRef.set(data).catch(e=>{
      console.error('Could not save data', e);
      showStatus('Could not save — check your connection.', true);
    });
  }

  let uidCounter = Date.now();
  function uid(){ uidCounter += 1; return 'm' + uidCounter; }

  // ---------- STATUS BANNER ----------
  function showStatus(msg, isError){
    const el = document.getElementById('connectionStatus');
    if(!el) return;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    if(!isError){
      setTimeout(()=>el.classList.remove('show'), 2500);
    }
  }
  function hideStatus(){
    const el = document.getElementById('connectionStatus');
    if(el) el.classList.remove('show');
  }

  // ---------- FIREBASE INIT ----------
  function initFirebase(){
    if(typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length){
      showStatus('Firebase is not configured yet. Fill in firebase-config.js.', true);
      renderAll();
      return;
    }

    showStatus('Connecting…', false);

    firebase.auth().onAuthStateChanged(user=>{
      if(!user) return;
      dbRef = firebase.database().ref(DB_PATH);
      dbRef.on('value', snapshot=>{
        const val = snapshot.val();
        if(val && Array.isArray(val.groups) && val.groups.length){
          data = val;
          if(!Array.isArray(data.attendance)) data.attendance = [];
        } else if(!firstLoadHandled){
          // Nothing in the database yet — seed it with the defaults.
          data = defaultData();
          saveData();
        }
        firstLoadHandled = true;
        hideStatus();
        renderAll();
      }, err=>{
        console.error('Database read failed', err);
        showStatus('Could not connect to the database. Check your Firebase rules and config.', true);
      });
    });

    firebase.auth().signInAnonymously().catch(e=>{
      console.error('Auth failed', e);
      showStatus('Could not sign in. Check that Anonymous auth is enabled in Firebase.', true);
    });
  }

  function renderAll(){
    renderGroups();
    const activeBtn = document.querySelector('nav button.active');
    const activeView = activeBtn ? activeBtn.dataset.view : 'groups';
    if(activeView === 'attendance') renderAttendanceView();
    if(activeView === 'points') renderPointsView();
  }

  // ---------- NAV ----------
  const navButtons = document.querySelectorAll('nav button');
  navButtons.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      navButtons.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      if(btn.dataset.view === 'attendance') renderAttendanceView();
      if(btn.dataset.view === 'points') renderPointsView();
    });
  });

  // ---------- GROUPS VIEW ----------
  function renderGroups(){
    const grid = document.getElementById('groupsGrid');
    grid.innerHTML = '';
    data.groups.forEach(group=>{
      const total = group.members.reduce((s,m)=>s+m.points,0);
      const card = document.createElement('div');
      card.className = 'crest';
      card.innerHTML = `
        <div class="crest-header">
          <div class="crest-badge">${group.members.length}</div>
          <input class="crest-name-input" value="${escapeAttr(group.name)}" data-group="${group.id}">
          <div class="crest-points">Total points: <strong>${total}</strong></div>
        </div>
        <div class="crest-body">
          <ul class="member-list">
            ${group.members.length ? group.members.map(m=>`
              <li>
                <span class="member-name">${escapeHtml(m.name)}</span>
                <span class="member-points">${m.points}</span>
                <button class="icon-btn" data-remove-member="${group.id}|${m.id}" title="Remove person">✕</button>
              </li>
            `).join('') : '<li class="empty-msg">No one added yet</li>'}
          </ul>
          <div class="add-member-row">
            <input type="text" placeholder="Add a person's name" data-add-input="${group.id}">
            <button data-add-btn="${group.id}">Add</button>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });

    // wire up group name edits
    grid.querySelectorAll('.crest-name-input').forEach(inp=>{
      inp.addEventListener('change', ()=>{
        const g = data.groups.find(g=>g.id===inp.dataset.group);
        if(g){ g.name = inp.value.trim() || g.name; saveData(); renderGroups(); }
      });
    });

    // add member buttons
    grid.querySelectorAll('[data-add-btn]').forEach(btn=>{
      const groupId = btn.dataset.addBtn;
      const input = grid.querySelector(`[data-add-input="${groupId}"]`);
      const addFn = ()=>{
        const name = input.value.trim();
        if(!name) return;
        const g = data.groups.find(g=>g.id===groupId);
        g.members.push({id:uid(), name, points:0});
        saveData();
        renderGroups();
      };
      btn.addEventListener('click', addFn);
      input.addEventListener('keydown', e=>{ if(e.key==='Enter') addFn(); });
    });

    // remove member buttons
    grid.querySelectorAll('[data-remove-member]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const [groupId, memberId] = btn.dataset.removeMember.split('|');
        const g = data.groups.find(g=>g.id===groupId);
        g.members = g.members.filter(m=>m.id!==memberId);
        saveData();
        renderGroups();
      });
    });
  }

  // ---------- ATTENDANCE VIEW ----------
  const attendanceDateInput = document.getElementById('attendanceDate');
  attendanceDateInput.valueAsDate = new Date();

  let currentAttendanceSelections = {}; // memberId -> status, for the date being edited

  function renderAttendanceView(){
    const wrap = document.getElementById('attendanceGroups');
    wrap.innerHTML = '';
    const dateStr = attendanceDateInput.value;
    const existing = data.attendance.find(a=>a.date===dateStr);
    currentAttendanceSelections = existing ? {...existing.records} : {};

    data.groups.forEach(group=>{
      const div = document.createElement('div');
      div.className = 'attendance-group';
      div.innerHTML = `
        <h3>${escapeHtml(group.name)}</h3>
        ${group.members.length ? group.members.map(m=>{
          const status = currentAttendanceSelections[m.id] || '';
          return `
          <div class="attendance-row">
            <span class="a-name">${escapeHtml(m.name)}</span>
            <div class="status-btns">
              <button class="status-btn present ${status==='present'?'selected':''}" data-member="${m.id}" data-status="present">Present</button>
              <button class="status-btn late ${status==='late'?'selected':''}" data-member="${m.id}" data-status="late">Late</button>
              <button class="status-btn absent ${status==='absent'?'selected':''}" data-member="${m.id}" data-status="absent">Absent</button>
            </div>
          </div>`;
        }).join('') : '<div class="empty-msg">No one in this group yet — add people in the Groups tab.</div>'}
      `;
      wrap.appendChild(div);
    });

    wrap.querySelectorAll('.status-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const memberId = btn.dataset.member;
        const status = btn.dataset.status;
        currentAttendanceSelections[memberId] = status;
        // refresh just this row's buttons
        const row = btn.closest('.attendance-row');
        row.querySelectorAll('.status-btn').forEach(b=>b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    renderHistory();
  }

  document.getElementById('saveAttendanceBtn').addEventListener('click', ()=>{
    const dateStr = attendanceDateInput.value;
    if(!dateStr) return;
    const existingIdx = data.attendance.findIndex(a=>a.date===dateStr);
    const record = {date: dateStr, records: {...currentAttendanceSelections}};
    if(existingIdx>-1) data.attendance[existingIdx] = record;
    else data.attendance.push(record);
    data.attendance.sort((a,b)=> a.date < b.date ? 1 : -1);
    saveData();
    const msg = document.getElementById('attendanceSavedMsg');
    msg.classList.add('show');
    setTimeout(()=>msg.classList.remove('show'), 1800);
    renderHistory();
  });

  attendanceDateInput.addEventListener('change', renderAttendanceView);

  function findMemberName(memberId){
    for(const g of data.groups){
      const m = g.members.find(m=>m.id===memberId);
      if(m) return m.name;
    }
    return 'Unknown';
  }

  function renderHistory(){
    const list = document.getElementById('historyList');
    if(data.attendance.length===0){
      list.innerHTML = '<p class="empty-msg">No meetings recorded yet.</p>';
      return;
    }
    list.innerHTML = data.attendance.map(entry=>{
      const tags = Object.entries(entry.records).map(([memberId,status])=>
        `<span class="tag ${status}">${escapeHtml(findMemberName(memberId))}</span>`
      ).join('');
      return `<div class="history-entry"><span class="h-date">${entry.date}</span>${tags || '<span class="empty-msg">No records</span>'}</div>`;
    }).join('');
  }

  // ---------- POINTS VIEW ----------
  const pointsGroupSelect = document.getElementById('pointsGroupSelect');
  const pointsMemberSelect = document.getElementById('pointsMemberSelect');

  function renderPointsView(){
    pointsGroupSelect.innerHTML = data.groups.map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
    populateMemberSelect();
    renderLeaderboard();
  }

  function populateMemberSelect(){
    const g = data.groups.find(g=>g.id===pointsGroupSelect.value) || data.groups[0];
    pointsMemberSelect.innerHTML = g.members.length
      ? g.members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')
      : '<option value="">No one in this group</option>';
  }
  pointsGroupSelect.addEventListener('change', populateMemberSelect);

  document.getElementById('addPointsBtn').addEventListener('click', ()=>{
    const g = data.groups.find(g=>g.id===pointsGroupSelect.value);
    const memberId = pointsMemberSelect.value;
    const amount = parseInt(document.getElementById('pointsAmount').value, 10) || 0;
    if(!g || !memberId || amount===0) return;
    const m = g.members.find(m=>m.id===memberId);
    m.points += amount;
    saveData();
    renderLeaderboard();
    renderGroups();
  });

  function renderLeaderboard(){
    const board = document.getElementById('leaderboard');
    board.innerHTML = data.groups.map(g=>{
      const total = g.members.reduce((s,m)=>s+m.points,0);
      const sorted = [...g.members].sort((a,b)=>b.points-a.points);
      return `
        <div class="lb-group">
          <h3>${escapeHtml(g.name)} <span class="lb-total">${total} pts</span></h3>
          ${sorted.length ? sorted.map((m,i)=>`
            <div class="lb-row"><span><span class="rank">${i+1}.</span>${escapeHtml(m.name)}</span><span>${m.points}</span></div>
          `).join('') : '<p class="empty-msg">No one added yet</p>'}
        </div>
      `;
    }).join('');
  }

  // ---------- helpers ----------
  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }
  function escapeAttr(str){ return escapeHtml(str); }

  // ---------- init ----------
  renderGroups();
  initFirebase();
})();
