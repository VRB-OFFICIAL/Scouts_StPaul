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
      attendance: [], // {date, records: {memberId: 'present'|'late'|'absent'}}
      tests: [] // {id, name, date, maxScore, scores: {memberId: number}}
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
          if(!Array.isArray(data.tests)) data.tests = [];
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
    if(activeView === 'people') renderPeopleView();
    if(activeView === 'tests') renderTestsView();
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
      if(btn.dataset.view === 'people') renderPeopleView();
      if(btn.dataset.view === 'tests') renderTestsView();
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
                <span class="member-name-role">
                  <span class="member-name">${escapeHtml(m.name)}</span>
                  ${m.role ? `<span class="member-role" style="font-size:${roleFontSize(m.role)}">${escapeHtml(m.role)}</span>` : ''}
                </span>
                <span class="member-actions">
                  <span class="member-points">${memberTotals(m).net}</span>
                  <button class="icon-btn role-edit-btn" data-edit-role="${m.id}" title="Set role">✎</button>
                  <button class="icon-btn" data-remove-member="${group.id}|${m.id}" title="Remove person">✕</button>
                </span>
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
    grid.querySelectorAll('[data-edit-role]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const m = findMemberById(btn.dataset.editRole);
        if(!m) return;
        const newRole = prompt('Role (e.g. Leader, 2nd in Command, 1st Year):', m.role || '');
        if(newRole === null) return;
        m.role = newRole.trim();
        saveData();
        renderGroups();
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
  const attendanceMaxPointsInput = document.getElementById('attendanceMaxPoints');

  let currentAttendanceSelections = {}; // memberId -> {status, excused, lateValue, lateUnit, uniform, tools}, for the date being edited
  let loadedAttendanceDate = null; // which date's saved records are currently loaded into currentAttendanceSelections
  let currentMaxPoints = 10; // max points for uniform & tools, shared, set per meeting

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

  function loadMaxPointsForDate(dateStr){
    const existing = data.attendance.find(a=>a.date===dateStr);
    if(existing && typeof existing.maxPoints === 'number') return existing.maxPoints;
    return 10;
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
      currentMaxPoints = loadMaxPointsForDate(dateStr);
      attendanceMaxPointsInput.value = currentMaxPoints;
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
          const uniformVal = sel.uniform === undefined || sel.uniform === null ? '' : sel.uniform;
          const toolsVal = sel.tools === undefined || sel.tools === null ? '' : sel.tools;
          return `
          <div class="attendance-row-group">
            <div class="attendance-row">
              <span class="a-name">${escapeHtml(m.name)}${summary ? ` <span class="a-summary ${status}">· ${escapeHtml(summary)}</span>` : ''}</span>
              <div class="uniform-tools-inputs">
                <label class="ut-label">Uniform <input type="number" min="0" max="${currentMaxPoints}" class="ut-input" data-member="${m.id}" data-kind="uniform" value="${escapeAttr(uniformVal)}" placeholder="/${currentMaxPoints}"></label>
                <label class="ut-label">Tools <input type="number" min="0" max="${currentMaxPoints}" class="ut-input" data-member="${m.id}" data-kind="tools" value="${escapeAttr(toolsVal)}" placeholder="/${currentMaxPoints}"></label>
              </div>
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

    wrap.querySelectorAll('.ut-input').forEach(inp=>{
      inp.addEventListener('input', ()=>{
        const memberId = inp.dataset.member;
        const kind = inp.dataset.kind; // 'uniform' or 'tools'
        const sel = normalizeRecord(currentAttendanceSelections[memberId]);
        if(!sel.status) sel.status = '';
        let val = inp.value === '' ? null : parseInt(inp.value, 10);
        if(val !== null){
          if(isNaN(val)) val = null;
          else {
            if(val < 0) val = 0;
            if(val > currentMaxPoints) val = currentMaxPoints;
          }
        }
        sel[kind] = val;
        currentAttendanceSelections[memberId] = sel;
      });
      inp.addEventListener('change', ()=>{
        // Reflect any clamping (e.g. typed value above max) back into the field
        const memberId = inp.dataset.member;
        const kind = inp.dataset.kind;
        const sel = normalizeRecord(currentAttendanceSelections[memberId]);
        const val = sel[kind];
        inp.value = (val === undefined || val === null) ? '' : val;
      });
    });

    renderHistory();
  }

  // ---------- DELETE ALL PAST MEETINGS ----------
  // Two-step "arm" so it can't be triggered by an accidental click:
  // 1) tap the lock icon and confirm twice to arm the red button
  // 2) tap the red button and confirm twice to actually delete
  // Locked meetings are never touched by this — unlock them individually
  // (or bulk-unlock, if you add that later) if you want them gone too.
  const armDeleteAllBtn = document.getElementById('armDeleteAllBtn');
  const deleteAllPastBtn = document.getElementById('deleteAllPastBtn');
  let deleteAllArmed = false;

  function setDeleteAllArmed(armed){
    deleteAllArmed = armed;
    deleteAllPastBtn.disabled = !armed;
    armDeleteAllBtn.textContent = armed ? '🔓' : '🔒';
    armDeleteAllBtn.classList.toggle('armed', armed);
    armDeleteAllBtn.title = armed
      ? 'Armed — click again to disarm, or use "Delete all past meetings" below'
      : 'Enable the delete-all button (requires confirming twice)';
  }
  setDeleteAllArmed(false);

  armDeleteAllBtn.addEventListener('click', ()=>{
    if(deleteAllArmed){
      setDeleteAllArmed(false);
      return;
    }
    if(!confirm('This will enable a button that deletes every UNLOCKED past meeting at once. Locked meetings are always kept. Continue?')) return;
    if(!confirm('Are you sure? This step only arms the button — nothing is deleted yet.')) return;
    setDeleteAllArmed(true);
  });

  deleteAllPastBtn.addEventListener('click', ()=>{
    if(!deleteAllArmed) return;
    const unlockedCount = data.attendance.filter(a=>!a.locked).length;
    if(unlockedCount === 0){
      alert('No unlocked meetings to delete — locked meetings are never removed by this button.');
      setDeleteAllArmed(false);
      return;
    }
    if(!confirm(`Delete all ${unlockedCount} unlocked past meeting(s)? Locked meetings will be kept. This can't be undone.`)) return;
    if(!confirm('Final check — really delete them all now?')) return;
    data.attendance = data.attendance.filter(a=>a.locked);
    saveData();
    setDeleteAllArmed(false);
    renderHistory();
  });

  attendanceMaxPointsInput.addEventListener('change', ()=>{
    let val = parseInt(attendanceMaxPointsInput.value, 10);
    if(isNaN(val) || val < 0) val = 10;
    currentMaxPoints = val;
    attendanceMaxPointsInput.value = val;
    // Re-clamp any already-entered uniform/tools values to the new max.
    Object.values(currentAttendanceSelections).forEach(sel=>{
      if(typeof sel.uniform === 'number' && sel.uniform > val) sel.uniform = val;
      if(typeof sel.tools === 'number' && sel.tools > val) sel.tools = val;
    });
    renderAttendanceView();
  });

  document.getElementById('saveAttendanceBtn').addEventListener('click', ()=>{
    const dateStr = attendanceDateInput.value;
    if(!dateStr) return;
    const existingIdx = data.attendance.findIndex(a=>a.date===dateStr);
    if(existingIdx>-1 && data.attendance[existingIdx].locked){
      alert('This meeting is locked. Unlock it in "Past meetings" before making changes.');
      return;
    }
    const record = {date: dateStr, records: {...currentAttendanceSelections}, maxPoints: currentMaxPoints};
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

  // Uniform/tools are always shown next to the name in Past meetings —
  // if a value was never set for that member at that meeting, it's
  // displayed as 0 rather than being left out. "Overall" is the sum of
  // the two, shown as a fraction out of the combined max (maxPoints*2),
  // so it moves automatically whenever either changes.
  function formatUniformToolsLabels(record, maxPoints){
    const sel = normalizeRecord(record);
    const uniformVal = typeof sel.uniform === 'number' ? sel.uniform : 0;
    const toolsVal = typeof sel.tools === 'number' ? sel.tools : 0;
    const overallVal = uniformVal + toolsVal;
    const overallMax = maxPoints * 2;
    return [
      `uniform · ${uniformVal}/${maxPoints}`,
      `tools · ${toolsVal}/${maxPoints}`,
      `overall · ${overallVal}/${overallMax}`
    ];
  }

  function renderHistory(){
    const list = document.getElementById('historyList');
    if(data.attendance.length===0){
      list.innerHTML = '<p class="empty-msg">No meetings recorded yet.</p>';
      return;
    }
    list.innerHTML = data.attendance.map(entry=>{
      const locked = !!entry.locked;
      const maxPoints = typeof entry.maxPoints === 'number' ? entry.maxPoints : 10;
      const tags = Object.entries(entry.records).map(([memberId,record])=>{
        const sel = normalizeRecord(record);
        const label = formatRecordLabel(findMemberName(memberId), record);
        const [uniformLabel, toolsLabel, overallLabel] = formatUniformToolsLabels(record, maxPoints);
        const removeBtn = locked ? '' : `<button class="tag-remove" data-remove-date="${entry.date}" data-remove-member="${memberId}" title="Remove ${escapeAttr(findMemberName(memberId))} from this meeting">✕</button>`;
        const mainTag = `<span class="tag ${sel.status}">${escapeHtml(label)} <span class="tag-ut-inline">· ${escapeHtml(uniformLabel)} · ${escapeHtml(toolsLabel)} · ${escapeHtml(overallLabel)}</span>${removeBtn}</span>`;
        return mainTag;
      }).join('');
      return `
      <div class="history-entry ${locked?'locked':''}">
        <div class="history-entry-header">
          <span class="h-date">${entry.date}${locked ? ' <span class="lock-label">Locked</span>' : ''} <span class="h-max-points">Max: ${maxPoints}</span></span>
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

  // ---------- PEOPLE VIEW (attendance stats per person) ----------
  let expandedPersonId = null; // which member's meeting-by-meeting detail is open

  // Pulls every meeting a member has a record for and boils it down into
  // present/late/absent counts plus an average uniform+tools percentage.
  // Percentage (not raw points) is averaged because maxPoints can change
  // meeting to meeting, so a raw average wouldn't be comparable.
  function computeAttendanceStats(memberId){
    let present = 0, late = 0, absent = 0;
    let pctSum = 0, pctCount = 0;
    const meetings = [];
    data.attendance.forEach(entry=>{
      const raw = entry.records[memberId];
      if(!raw) return;
      const sel = normalizeRecord(raw);
      if(sel.status === 'present') present++;
      else if(sel.status === 'late') late++;
      else if(sel.status === 'absent') absent++;

      const maxPoints = typeof entry.maxPoints === 'number' ? entry.maxPoints : 10;
      const uniformVal = typeof sel.uniform === 'number' ? sel.uniform : null;
      const toolsVal = typeof sel.tools === 'number' ? sel.tools : null;
      let overall = null, overallMax = maxPoints * 2, pct = null;
      if(uniformVal !== null || toolsVal !== null){
        overall = (uniformVal||0) + (toolsVal||0);
        pct = overallMax > 0 ? (overall / overallMax * 100) : 0;
        pctSum += pct; pctCount++;
      }
      meetings.push({date: entry.date, sel, uniformVal, toolsVal, overall, overallMax, pct, locked: !!entry.locked});
    });
    meetings.sort((a,b)=> a.date < b.date ? 1 : -1);
    return {
      present, late, absent,
      totalRecorded: present + late + absent,
      avgPercent: pctCount ? (pctSum / pctCount) : null,
      meetings
    };
  }

  function attendanceTendencyLabel(stats){
    if(stats.totalRecorded === 0) return 'No meetings recorded yet';
    if(stats.late === 0 && stats.absent === 0) return 'Always present';
    if(stats.late > stats.absent) return 'More often late than absent';
    if(stats.absent > stats.late) return 'More often absent than late';
    return 'Equally late and absent';
  }

  function renderPeopleView(){
    const wrap = document.getElementById('peopleList');
    wrap.innerHTML = data.groups.map(g=>{
      const rows = g.members.map(m=>{
        const stats = computeAttendanceStats(m.id);
        const isOpen = expandedPersonId === m.id;
        const avgLabel = stats.avgPercent !== null ? `${Math.round(stats.avgPercent)}% avg` : 'No points yet';
        return `
          <div class="pp-member">
            <button class="pp-member-row" data-toggle-person="${m.id}">
              <span class="pp-name">${escapeHtml(m.name)} <span class="pp-caret">${isOpen?'▾':'▸'}</span></span>
              <span class="pp-stats">
                <span class="pp-stat avg">${avgLabel}</span>
                <span class="pp-stat present" title="Present">${stats.present}P</span>
                <span class="pp-stat late" title="Late">${stats.late}L</span>
                <span class="pp-stat absent" title="Absent">${stats.absent}A</span>
              </span>
            </button>
            <div class="pp-detail ${isOpen?'show':''}">
              <p class="pp-tendency">${attendanceTendencyLabel(stats)}</p>
              ${stats.meetings.length ? stats.meetings.map(mt=>`
                <div class="pp-meeting-row">
                  <span class="pp-meeting-date">${mt.date}${mt.locked ? ' <span class="lock-label">Locked</span>' : ''}</span>
                  <span class="a-summary ${mt.sel.status}">${escapeHtml(statusSummaryText(mt.sel) || '—')}</span>
                  <span class="pp-meeting-pts">${mt.overall!==null ? `${mt.overall}/${mt.overallMax} · ${Math.round(mt.pct)}%` : 'No points recorded'}</span>
                </div>
              `).join('') : '<p class="empty-msg">No meetings recorded yet</p>'}
            </div>
          </div>
        `;
      }).join('');
      return `
        <div class="pp-group">
          <h3>${escapeHtml(g.name)}</h3>
          ${g.members.length ? rows : '<p class="empty-msg">No one added yet</p>'}
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('[data-toggle-person]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.togglePerson;
        expandedPersonId = expandedPersonId === id ? null : id;
        renderPeopleView();
      });
    });
  }

  // ---------- TESTS VIEW ----------
  const testDateInput = document.getElementById('testDateInput');
  testDateInput.valueAsDate = new Date();
  let expandedTestId = null; // which test's score sheet is currently open

  document.getElementById('createTestBtn').addEventListener('click', ()=>{
    const nameInput = document.getElementById('testNameInput');
    const maxInput = document.getElementById('testMaxInput');
    const name = nameInput.value.trim();
    const date = testDateInput.value;
    let maxScore = parseInt(maxInput.value, 10);
    if(isNaN(maxScore) || maxScore <= 0) maxScore = 100;
    if(!name){ alert('Give the test a name first.'); return; }
    if(!date){ alert('Pick a date for the test.'); return; }
    const test = {id: uid(), name, date, maxScore, scores:{}};
    data.tests.push(test);
    data.tests.sort((a,b)=> a.date < b.date ? 1 : -1);
    saveData();
    nameInput.value = '';
    maxInput.value = 100;
    expandedTestId = test.id;
    renderTestsView();
  });

  function renderTestsView(){
    const wrap = document.getElementById('testsList');
    if(!data.tests.length){
      wrap.innerHTML = '<p class="empty-msg">No tests recorded yet — add one above.</p>';
      return;
    }
    wrap.innerHTML = data.tests.map(t=>{
      const isOpen = expandedTestId === t.id;
      const enteredScores = Object.values(t.scores).filter(v=>typeof v === 'number');
      const avgPct = enteredScores.length
        ? (enteredScores.reduce((s,v)=>s+v,0) / enteredScores.length / t.maxScore * 100)
        : null;

      const groupBlocks = data.groups.filter(g=>g.members.length).map(g=>`
        <div class="test-group-block">
          <h4>${escapeHtml(g.name)}</h4>
          ${g.members.map(m=>{
            const score = t.scores[m.id];
            const scoreVal = typeof score === 'number' ? score : '';
            const pct = typeof score === 'number' ? (score / t.maxScore * 100) : null;
            return `
              <div class="test-score-row">
                <span class="test-score-name">${escapeHtml(m.name)}</span>
                <span class="test-score-input-wrap">
                  <input type="number" min="0" max="${t.maxScore}" class="test-score-input" data-test="${t.id}" data-member="${m.id}" value="${scoreVal}" placeholder="0">
                  <span class="test-score-max">/ ${t.maxScore}</span>
                </span>
                <span class="test-score-pct">${pct!==null ? Math.round(pct)+'%' : '—'}</span>
              </div>
            `;
          }).join('')}
        </div>
      `).join('');

      return `
        <div class="test-card">
          <button class="test-card-header" data-toggle-test="${t.id}">
            <span class="test-title">${escapeHtml(t.name)} <span class="bd-caret">${isOpen?'▾':'▸'}</span></span>
            <span class="test-meta">
              <span class="test-date">${t.date}</span>
              <span class="test-avg">${avgPct!==null ? `Avg ${Math.round(avgPct)}%` : 'No scores yet'}</span>
            </span>
          </button>
          <div class="test-body ${isOpen?'show':''}">
            ${groupBlocks || '<p class="empty-msg">No one added yet — add people in the Groups tab.</p>'}
            <div class="test-actions">
              <button class="icon-btn danger-text" data-delete-test="${t.id}" title="Delete this test">✕ Delete test</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    wrap.querySelectorAll('[data-toggle-test]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.toggleTest;
        expandedTestId = expandedTestId === id ? null : id;
        renderTestsView();
      });
    });

    wrap.querySelectorAll('.test-score-input').forEach(inp=>{
      inp.addEventListener('change', ()=>{
        const test = data.tests.find(t=>t.id===inp.dataset.test);
        if(!test) return;
        let val = inp.value === '' ? null : parseFloat(inp.value);
        if(val !== null){
          if(isNaN(val)) val = null;
          else{
            if(val < 0) val = 0;
            if(val > test.maxScore) val = test.maxScore;
          }
        }
        if(val === null) delete test.scores[inp.dataset.member];
        else test.scores[inp.dataset.member] = val;
        saveData();
        renderTestsView();
      });
    });

    wrap.querySelectorAll('[data-delete-test]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.deleteTest;
        const test = data.tests.find(t=>t.id===id);
        if(!test) return;
        if(!confirm(`Delete "${test.name}" (${test.date}) and all its scores? This can't be undone.`)) return;
        data.tests = data.tests.filter(t=>t.id!==id);
        if(expandedTestId === id) expandedTestId = null;
        saveData();
        renderTestsView();
      });
    });
  }

  // ---------- helpers ----------
  // Longer role text gets progressively smaller so it never crowds out
  // the name or points, while short roles like "Leader" stay easy to read.
  function roleFontSize(role){
    const len = role.length;
    if(len <= 8) return '0.78rem';
    if(len <= 14) return '0.7rem';
    if(len <= 20) return '0.63rem';
    if(len <= 28) return '0.57rem';
    return '0.52rem';
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }
  function escapeAttr(str){ return escapeHtml(str); }

  // ---------- init ----------
  renderGroups();
  initFirebase();
})();
