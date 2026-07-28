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

  function migrateData(d){
    d.groups.forEach(g=>{
      g.members.forEach(m=>{
        if(typeof m.role !== 'string'){
          m.role = '';
        }
        if(!Array.isArray(m.pointLog)){
          m.pointLog = [];
          // Carry over any pre-existing plain point total as one dated entry,
          // so nobody's history/totals appear to reset when this ships.
          if(typeof m.points === 'number' && m.points !== 0){
            m.pointLog.push({
              id: uid(),
              date: new Date().toISOString().slice(0,10),
              amount: m.points,
              reason: 'Carried over from before point history was tracked'
            });
          }
        }
        delete m.points;
      });
    });
    return d;
  }

  // A member's points now live entirely in m.pointLog — an array of
  // {id, date, amount, reason}. Gained/lost/net are always derived from it,
  // never stored separately, so they can never drift out of sync.
  function memberTotals(member){
    const log = Array.isArray(member.pointLog) ? member.pointLog : [];
    let gained = 0, lost = 0;
    log.forEach(e=>{
      if(e.amount > 0) gained += e.amount;
      else lost += -e.amount;
    });
    return { gained, lost, net: gained - lost };
  }

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
          data = migrateData(parsed);
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
    if(activeView === 'breakdown') renderBreakdownView();
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
      if(btn.dataset.view === 'breakdown') renderBreakdownView();
    });
  });

  // ---------- GROUPS VIEW ----------
  function renderGroups(){
    const grid = document.getElementById('groupsGrid');
    grid.innerHTML = '';
    data.groups.forEach(group=>{
      const total = group.members.reduce((s,m)=>s+memberTotals(m).net,0);
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
                <input type="text" class="member-role-input" placeholder="role..." value="${escapeAttr(m.role||'')}" data-role-member="${m.id}">
                <span class="member-points">${memberTotals(m).net}</span>
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

    // wire up member role edits
    grid.querySelectorAll('[data-role-member]').forEach(inp=>{
      inp.addEventListener('change', ()=>{
        const m = findMemberById(inp.dataset.roleMember);
        if(m){ m.role = inp.value.trim(); saveData(); }
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
        g.members.push({id:uid(), name, role:'', pointLog:[]});
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
  let loadedAttendanceDate = null; // which date's saved records are currently loaded into currentAttendanceSelections

  // A record may be stored either as a plain string (older saves, before
  // this feature existed) or as an object with extra detail. This always
  // returns the object form so the rest of the code has one shape to deal with.
  function normalizeRecord(record){
    if(!record) return {status:''};
    if(typeof record === 'string') return {status: record};
    return record;
  }

  function loadSelectionsForDate(dateStr){
    const existing = data.attendance.find(a=>a.date===dateStr);
    const selections = {};
    if(existing){
      Object.entries(existing.records).forEach(([memberId, record])=>{
        selections[memberId] = {...normalizeRecord(record)};
      });
    }
    return selections;
  }

  // Compact "Present" / "Late · 15 Mins" / "Absent · Excused" summary text
  // shown next to each name, live, as selections are made.
  function statusSummaryText(sel){
    if(!sel || !sel.status) return '';
    if(sel.status === 'present') return 'Present';
    if(sel.status === 'late'){
      if(sel.lateValue){
        const unit = sel.lateUnit === 'hours' ? 'Hrs' : 'Mins';
        return `Late · ${sel.lateValue} ${unit}`;
      }
      return 'Late';
    }
    if(sel.status === 'absent'){
      if(sel.excused === true) return 'Absent · Excused';
      if(sel.excused === false) return 'Absent · Unexcused';
      return 'Absent';
    }
    return '';
  }

  function renderAttendanceView(){
    const wrap = document.getElementById('attendanceGroups');
    const dateStr = attendanceDateInput.value;

    // Only pull fresh from saved data when we've switched to a different
    // date. Re-rendering after a button click (same date) must NOT touch
    // currentAttendanceSelections, or every click would immediately erase
    // itself before it ever showed as selected.
    if(loadedAttendanceDate !== dateStr){
      currentAttendanceSelections = loadSelectionsForDate(dateStr);
      loadedAttendanceDate = dateStr;
    }

    wrap.innerHTML = '';

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
          const summary = statusSummaryText(sel);
          return `
          <div class="attendance-row-group">
            <div class="attendance-row">
              <span class="a-name">${escapeHtml(m.name)}${summary ? ` <span class="a-summary ${status}">· ${escapeHtml(summary)}</span>` : ''}</span>
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
        // Update just this row's summary text directly (no full re-render,
        // so the input keeps focus while the person is still typing).
        const row = inp.closest('.attendance-row-group').querySelector('.attendance-row');
        let summaryEl = row.querySelector('.a-summary');
        const summaryText = statusSummaryText(sel);
        if(summaryText){
          if(!summaryEl){
            summaryEl = document.createElement('span');
            row.querySelector('.a-name').appendChild(document.createTextNode(' '));
            row.querySelector('.a-name').appendChild(summaryEl);
          }
          summaryEl.className = 'a-summary late';
          summaryEl.textContent = '· ' + summaryText;
        }
      });
    });

    renderHistory();
  }

  document.getElementById('saveAttendanceBtn').addEventListener('click', ()=>{
    const dateStr = attendanceDateInput.value;
    if(!dateStr) return;
    const existingIdx = data.attendance.findIndex(a=>a.date===dateStr);
    if(existingIdx>-1 && data.attendance[existingIdx].locked){
      alert('This meeting is locked. Unlock it in "Past meetings" before making changes.');
      return;
    }
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
      const locked = !!entry.locked;
      const tags = Object.entries(entry.records).map(([memberId,record])=>{
        const sel = normalizeRecord(record);
        const label = formatRecordLabel(findMemberName(memberId), record);
        const removeBtn = locked ? '' : `<button class="tag-remove" data-remove-date="${entry.date}" data-remove-member="${memberId}" title="Remove ${escapeAttr(findMemberName(memberId))} from this meeting">✕</button>`;
        return `<span class="tag ${sel.status}">${escapeHtml(label)}${removeBtn}</span>`;
      }).join('');
      return `
      <div class="history-entry ${locked?'locked':''}">
        <div class="history-entry-header">
          <span class="h-date">${entry.date}${locked ? ' <span class="lock-label">Locked</span>' : ''}</span>
          <div class="history-entry-actions">
            <button class="icon-btn lock-btn" data-lock-date="${entry.date}" title="${locked?'Unlock this meeting':'Lock this meeting'}">${locked?'🔒':'🔓'}</button>
            <button class="icon-btn delete-btn" data-delete-date="${entry.date}" title="${locked?'Locked — unlock to delete':'Delete this meeting'}" ${locked?'disabled':''}>✕</button>
          </div>
        </div>
        <div class="history-tags">${tags || '<span class="empty-msg">No records</span>'}</div>
      </div>`;
    }).join('');

    list.querySelectorAll('.lock-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const date = btn.dataset.lockDate;
        const entry = data.attendance.find(a=>a.date===date);
        if(!entry) return;
        entry.locked = !entry.locked;
        saveData();
        renderHistory();
      });
    });

    list.querySelectorAll('.delete-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const date = btn.dataset.deleteDate;
        const entry = data.attendance.find(a=>a.date===date);
        if(!entry || entry.locked) return; // locked meetings can't be deleted
        if(!confirm(`Delete the attendance record for ${date}? This can't be undone.`)) return;
        data.attendance = data.attendance.filter(a=>a.date!==date);
        saveData();
        renderHistory();
      });
    });

    list.querySelectorAll('.tag-remove').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const date = btn.dataset.removeDate;
        const memberId = btn.dataset.removeMember;
        const entry = data.attendance.find(a=>a.date===date);
        if(!entry || entry.locked) return; // locked meetings can't be edited
        const name = findMemberName(memberId);
        if(!confirm(`Remove ${name} from the ${date} meeting record?`)) return;
        delete entry.records[memberId];
        saveData();
        renderHistory();
      });
    });
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
    const reasonInput = document.getElementById('pointsReason');
    const reason = reasonInput ? reasonInput.value.trim() : '';
    if(!g || !memberId || amount===0) return;
    const m = g.members.find(m=>m.id===memberId);
    if(!Array.isArray(m.pointLog)) m.pointLog = [];
    m.pointLog.push({
      id: uid(),
      date: new Date().toISOString().slice(0,10),
      amount,
      reason: reason || (amount>0 ? 'Points added' : 'Points deducted')
    });
    saveData();
    document.getElementById('pointsAmount').value = 1;
    if(reasonInput) reasonInput.value = '';
    renderLeaderboard();
    renderGroups();
  });

  function renderLeaderboard(){
    const board = document.getElementById('leaderboard');
    board.innerHTML = data.groups.map(g=>{
      const total = g.members.reduce((s,m)=>s+memberTotals(m).net,0);
      const sorted = [...g.members].sort((a,b)=>memberTotals(b).net-memberTotals(a).net);
      return `
        <div class="lb-group">
          <h3>${escapeHtml(g.name)} <span class="lb-total">${total} pts</span></h3>
          ${sorted.length ? sorted.map((m,i)=>`
            <div class="lb-row"><span><span class="rank">${i+1}.</span>${escapeHtml(m.name)}</span><span>${memberTotals(m).net}</span></div>
          `).join('') : '<p class="empty-msg">No one added yet</p>'}
        </div>
      `;
    }).join('');
  }

  // ---------- GROUPS BREAKDOWN VIEW ----------
  let expandedMemberId = null; // which member's log is currently expanded, if any

  function renderBreakdownView(){
    const wrap = document.getElementById('breakdownGroups');
    wrap.innerHTML = data.groups.map(g=>{
      const memberRows = g.members.map(m=>{
        const t = memberTotals(m);
        const isOpen = expandedMemberId === m.id;
        const log = [...(m.pointLog||[])].sort((a,b)=> a.date < b.date ? 1 : -1);
        return `
          <div class="bd-member">
            <button class="bd-member-row" data-toggle-member="${m.id}">
              <span class="bd-name">${escapeHtml(m.name)} <span class="bd-caret">${isOpen?'▾':'▸'}</span></span>
              <span class="bd-stats">
                <span class="bd-stat gained">+${t.gained}</span>
                <span class="bd-stat lost">-${t.lost}</span>
                <span class="bd-stat net">${t.net}</span>
              </span>
            </button>
            <div class="bd-log ${isOpen?'show':''}">
              ${log.length ? log.map(e=>`
                <div class="bd-log-entry">
                  <span class="bd-log-date">${e.date}</span>
                  <span class="bd-log-reason">${escapeHtml(e.reason||'')}</span>
                  <span class="bd-log-amount ${e.amount>0?'gained':'lost'}">${e.amount>0?'+':''}${e.amount}</span>
                  <button class="icon-btn bd-edit" data-edit-entry="${m.id}|${e.id}" title="Edit">✎</button>
                  <button class="icon-btn bd-delete" data-delete-entry="${m.id}|${e.id}" title="Delete">✕</button>
                </div>
              `).join('') : '<p class="empty-msg">No point history yet</p>'}
              <div class="bd-add-row">
                <input type="date" class="bd-add-date" data-member="${m.id}" value="${new Date().toISOString().slice(0,10)}">
                <input type="number" class="bd-add-amount" data-member="${m.id}" placeholder="+/- amount">
                <input type="text" class="bd-add-reason" data-member="${m.id}" placeholder="Reason">
                <button class="bd-add-btn" data-add-entry="${m.id}">Add</button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      const groupTotals = g.members.reduce((acc,m)=>{
        const t = memberTotals(m);
        acc.gained += t.gained; acc.lost += t.lost; acc.net += t.net;
        return acc;
      }, {gained:0, lost:0, net:0});

      return `
        <div class="bd-group">
          <div class="bd-group-header">
            <h3>${escapeHtml(g.name)}</h3>
            <span class="bd-stats">
              <span class="bd-stat gained">+${groupTotals.gained}</span>
              <span class="bd-stat lost">-${groupTotals.lost}</span>
              <span class="bd-stat net">${groupTotals.net}</span>
            </span>
          </div>
          ${g.members.length ? memberRows : '<p class="empty-msg">No one added yet</p>'}
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('[data-toggle-member]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.toggleMember;
        expandedMemberId = expandedMemberId === id ? null : id;
        renderBreakdownView();
      });
    });

    wrap.querySelectorAll('[data-add-entry]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const memberId = btn.dataset.addEntry;
        const member = findMemberById(memberId);
        if(!member) return;
        const dateEl = wrap.querySelector(`.bd-add-date[data-member="${memberId}"]`);
        const amountEl = wrap.querySelector(`.bd-add-amount[data-member="${memberId}"]`);
        const reasonEl = wrap.querySelector(`.bd-add-reason[data-member="${memberId}"]`);
        const amount = parseInt(amountEl.value, 10) || 0;
        if(amount === 0) return;
        if(!Array.isArray(member.pointLog)) member.pointLog = [];
        member.pointLog.push({
          id: uid(),
          date: dateEl.value || new Date().toISOString().slice(0,10),
          amount,
          reason: reasonEl.value.trim() || (amount>0 ? 'Points added' : 'Points deducted')
        });
        saveData();
        renderGroups();
        renderBreakdownView();
      });
    });

    wrap.querySelectorAll('[data-edit-entry]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const [memberId, entryId] = btn.dataset.editEntry.split('|');
        const member = findMemberById(memberId);
        const entry = member && member.pointLog.find(e=>e.id===entryId);
        if(!entry) return;
        const newAmount = prompt('Amount (use a minus sign for a deduction):', entry.amount);
        if(newAmount === null) return;
        const parsed = parseInt(newAmount, 10);
        if(isNaN(parsed) || parsed === 0) return;
        const newReason = prompt('Reason:', entry.reason || '');
        if(newReason === null) return;
        const newDate = prompt('Date (YYYY-MM-DD):', entry.date);
        if(newDate === null) return;
        entry.amount = parsed;
        entry.reason = newReason.trim();
        entry.date = newDate.trim() || entry.date;
        saveData();
        renderGroups();
        renderBreakdownView();
      });
    });

    wrap.querySelectorAll('[data-delete-entry]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const [memberId, entryId] = btn.dataset.deleteEntry.split('|');
        const member = findMemberById(memberId);
        if(!member) return;
        if(!confirm('Delete this point log entry?')) return;
        member.pointLog = member.pointLog.filter(e=>e.id!==entryId);
        saveData();
        renderGroups();
        renderBreakdownView();
      });
    });
  }

  function findMemberById(memberId){
    for(const g of data.groups){
      const m = g.members.find(m=>m.id===memberId);
      if(m) return m;
    }
    return null;
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
