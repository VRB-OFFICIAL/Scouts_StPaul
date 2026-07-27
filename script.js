(function(){
  const COLLECTION = 'troopTracker';
  const DOC_ID = 'data';

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
  let docRef = null;
  let firstLoadHandled = false;

  function saveData(){
    if(!docRef){
      console.warn('Not connected yet — change was not saved.');
      return;
    }
    // Firestore documents can't store nested arrays directly, so the
    // whole data object is JSON-stringified into a single field.
    docRef.set({ json: JSON.stringify(data) }).catch(e=>{
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
      docRef = firebase.firestore().collection(COLLECTION).doc(DOC_ID);
      docRef.onSnapshot(snapshot=>{
        const snap = snapshot.data();
        let parsed = null;
        if(snap && typeof snap.json === 'string'){
          try{ parsed = JSON.parse(snap.json); }
          catch(e){ console.error('Could not parse stored data', e); }
        }
        if(parsed && Array.isArray(parsed.groups) && parsed.groups.length){
          data = parsed;
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
        showStatus('Database error: ' + (err.code || err.message || err), true);
      });
    });

    firebase.auth().signInAnonymously().catch(e=>{
      console.error('Auth failed', e);
      showStatus('Sign-in error: ' + (e.code || e.message || e), true);
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

  let currentAttendanceSelections = {}; // memberId -> {status, excused, lateValue, lateUnit}, for the date being edited

  // A record may be stored either as a plain string (older saves, before
  // this feature existed) or as an object with extra detail. This always
  // returns the object form so the rest of the code has one shape to deal with.
  function normalizeRecord(record){
    if(!record) return {status:''};
    if(typeof record === 'string') return {status: record};
    return record;
  }

  function renderAttendanceView(){
    const wrap = document.getElementById('attendanceGroups');
    wrap.innerHTML = '';
    const dateStr = attendanceDateInput.value;
    const existing = data.attendance.find(a=>a.date===dateStr);
    currentAttendanceSelections = {};
    if(existing){
      Object.entries(existing.records).forEach(([memberId, record])=>{
        currentAttendanceSelections[memberId] = {...normalizeRecord(record)};
      });
    }

    data.groups.forEach(group=>{
      const div = document.createElement('div');
      div.className = 'attendance-group';
      div.innerHTML = `
        <h3>${escapeHtml(group.name)}</h3>
        ${group.members.length ? group.members.map(m=>{
          const sel = normalizeRecord(currentAttendanceSelections[m.id]);
          const status = sel.status || '';
          const excused = sel.excused;
          const lateValue = sel.lateValue || '';
          const lateUnit = sel.lateUnit || 'minutes';
          return `
          <div class="attendance-row-group">
            <div class="attendance-row">
              <span class="a-name">${escapeHtml(m.name)}</span>
              <div class="status-btns">
                <button class="status-btn present ${status==='present'?'selected':''}" data-member="${m.id}" data-status="present">Present</button>
                <button class="status-btn late ${status==='late'?'selected':''}" data-member="${m.id}" data-status="late">Late</button>
                <button class="status-btn absent ${status==='absent'?'selected':''}" data-member="${m.id}" data-status="absent">Absent</button>
              </div>
            </div>
            <div class="detail-row absent-detail ${status==='absent'?'show':''}" data-member="${m.id}">
              <span class="detail-label">Reason:</span>
              <div class="sub-btns">
                <button class="sub-btn excused ${excused===true?'selected':''}" data-member="${m.id}" data-excused="true">With excuse</button>
                <button class="sub-btn unexcused ${excused===false?'selected':''}" data-member="${m.id}" data-excused="false">Without excuse</button>
              </div>
            </div>
            <div class="detail-row late-detail ${status==='late'?'show':''}" data-member="${m.id}">
              <span class="detail-label">Late by:</span>
              <input type="number" min="0" class="late-amount" data-member="${m.id}" value="${escapeAttr(lateValue)}" placeholder="e.g. 15">
              <div class="unit-btns">
                <button class="unit-btn ${lateUnit==='minutes'?'selected':''}" data-member="${m.id}" data-unit="minutes">Minutes</button>
                <button class="unit-btn ${lateUnit==='hours'?'selected':''}" data-member="${m.id}" data-unit="hours">Hours</button>
              </div>
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
        const existingSel = normalizeRecord(currentAttendanceSelections[memberId]);
        const sel = { status };
        if(status === 'absent' && existingSel.status === 'absent') sel.excused = existingSel.excused;
        if(status === 'late' && existingSel.status === 'late'){
          sel.lateValue = existingSel.lateValue;
          sel.lateUnit = existingSel.lateUnit || 'minutes';
        }
        if(status === 'late' && !sel.lateUnit) sel.lateUnit = 'minutes';
        currentAttendanceSelections[memberId] = sel;
        renderAttendanceView();
      });
    });

    wrap.querySelectorAll('.sub-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const memberId = btn.dataset.member;
        const sel = normalizeRecord(currentAttendanceSelections[memberId]);
        sel.status = 'absent';
        sel.excused = btn.dataset.excused === 'true';
        currentAttendanceSelections[memberId] = sel;
        renderAttendanceView();
      });
    });

    wrap.querySelectorAll('.unit-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const memberId = btn.dataset.member;
        const sel = normalizeRecord(currentAttendanceSelections[memberId]);
        sel.status = 'late';
        sel.lateUnit = btn.dataset.unit;
        currentAttendanceSelections[memberId] = sel;
        renderAttendanceView();
      });
    });

    wrap.querySelectorAll('.late-amount').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const memberId = inp.dataset.member;
        const sel = normalizeRecord(currentAttendanceSelections[memberId]);
        sel.status = 'late';
        sel.lateValue = inp.value;
        if(!sel.lateUnit) sel.lateUnit = 'minutes';
        currentAttendanceSelections[memberId] = sel;
        // no re-render here — keeps focus in the input while typing
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

  function formatRecordLabel(name, record){
    const sel = normalizeRecord(record);
    if(sel.status === 'absent'){
      const excuseLabel = sel.excused === true ? 'excused' : sel.excused === false ? 'unexcused' : '';
      return excuseLabel ? `${name} · ${excuseLabel}` : name;
    }
    if(sel.status === 'late' && sel.lateValue){
      const unit = sel.lateUnit || 'minutes';
      const unitLabel = unit === 'hours' ? 'hr' : 'min';
      return `${name} · ${sel.lateValue}${unitLabel}`;
    }
    return name;
  }

  function renderHistory(){
    const list = document.getElementById('historyList');
    if(data.attendance.length===0){
      list.innerHTML = '<p class="empty-msg">No meetings recorded yet.</p>';
      return;
    }
    list.innerHTML = data.attendance.map(entry=>{
      const tags = Object.entries(entry.records).map(([memberId,record])=>{
        const sel = normalizeRecord(record);
        const label = formatRecordLabel(findMemberName(memberId), record);
        return `<span class="tag ${sel.status}">${escapeHtml(label)}</span>`;
      }).join('');
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
