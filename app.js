(() => {
  // ---------- DOM ----------
  const setupContainer = document.getElementById('setupContainer');
  const gameContainer  = document.getElementById('gameContainer');
  const boardEl        = document.getElementById('board');
  const messageEl      = document.getElementById('message');
  const turnEl         = document.getElementById('turn');
  const capWhiteEl     = document.getElementById('capWhite');
  const capBlackEl     = document.getElementById('capBlack');

  const startWhiteBtn  = document.getElementById('startWhite');
  const startBlackBtn  = document.getElementById('startBlack');
  const resetBtn       = document.getElementById('resetBtn');
  const resurrectBtn   = document.getElementById('resurrectBtn');

  // （dialog/overlayは一切使わない。DOMに残ってても無視）

  // --- 盤面タップを邪魔するレイヤーを強制で無効化（CSS不要） ---
const __overlay = document.getElementById('overlay');
if (__overlay) {
  __overlay.style.display = 'none';
  __overlay.style.pointerEvents = 'none';
}
const __dialog = document.getElementById('dialog');
if (__dialog) {
  __dialog.style.display = 'none';
}
  // ---------- Game State ----------
  let playerColor = null; // 'white' | 'black'
  let aiColor = null;     // opposite
  let currentTurn = 'white';
  let board = Array(64).fill(null);

  let selected = null;
  let legalHints = new Set();
  let captureHints = new Set();

  // Resurrection
  let isResurrectionMode = false;
  let selectedCapturedPiece = null;

  const capturedPieces = { white: [], black: [] };

  const PIECE_UNI = {
    white: { king:'♔', queen:'♕', rook:'♖', bishop:'♗', knight:'♘', pawn:'♙' },
    black: { king:'♚', queen:'♛', rook:'♜', bishop:'♝', knight:'♞', pawn:'♟' }
  };

  function pieceAt(i){ return board[i]; }
  function inBounds(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
  function idxToRC(i){ return { r: Math.floor(i/8), c: i%8 }; }
  function rcToIdx(r,c){ return r*8 + c; }
  function opposite(color){ return color === 'white' ? 'black' : 'white'; }

  // ---------- PWA SW ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
    });
  }

  // ---------- Setup ----------
  function initBoard() {
    board = Array(64).fill(null);
    const set = (r,c,type,color) => board[rcToIdx(r,c)] = ({type,color});

    set(0,0,'rook','black'); set(0,1,'knight','black'); set(0,2,'bishop','black'); set(0,3,'queen','black');
    set(0,4,'king','black'); set(0,5,'bishop','black'); set(0,6,'knight','black'); set(0,7,'rook','black');
    for (let c=0;c<8;c++) set(1,c,'pawn','black');

    for (let c=0;c<8;c++) set(6,c,'pawn','white');
    set(7,0,'rook','white'); set(7,1,'knight','white'); set(7,2,'bishop','white'); set(7,3,'queen','white');
    set(7,4,'king','white'); set(7,5,'bishop','white'); set(7,6,'knight','white'); set(7,7,'rook','white');
  }

  // ---------- Rendering ----------
  function renderBoard() {
    boardEl.innerHTML = '';
    for (let i=0;i<64;i++){
      const {r,c} = idxToRC(i);
      const sq = document.createElement('div');
      sq.className = 'sq ' + ((r+c)%2===0 ? 'light' : 'dark');
      sq.dataset.index = String(i);

      if (selected === i) sq.classList.add('sel');
      if (legalHints.has(i)) sq.classList.add('hint');
      if (captureHints.has(i)) sq.classList.add('captureHint');

      const p = pieceAt(i);
      if (p) sq.textContent = PIECE_UNI[p.color][p.type];

      boardEl.appendChild(sq);
    }
  }

  function renderCapturedPieces() {
    capWhiteEl.innerHTML = '';
    capBlackEl.innerHTML = '';

    const renderList = (color, el) => {
      capturedPieces[color].forEach((p) => {
        const sp = document.createElement('span');
        sp.className = 'capPiece';
        sp.textContent = PIECE_UNI[p.color][p.type];

        sp.addEventListener('pointerup', (ev) => {
          ev.preventDefault();

          if (!isResurrectionMode) return;
          if (currentTurn !== playerColor) return;
          if (color !== playerColor) return;

          selectedCapturedPiece = p;

          [...capWhiteEl.querySelectorAll('.capPiece')].forEach(n => n.classList.remove('selected'));
          [...capBlackEl.querySelectorAll('.capPiece')].forEach(n => n.classList.remove('selected'));
          sp.classList.add('selected');

          messageEl.textContent = '置きたいマス（空きマス）をタップしてください。';
        }, { passive: false });

        el.appendChild(sp);
      });
    };

    renderList('white', capWhiteEl);
    renderList('black', capBlackEl);
  }

  function updateTurnUI() {
    turnEl.textContent = (currentTurn === 'white' ? '白のターン' : '黒のターン');
  }

  function updateResurrectButtonState() {
    const can = playerColor
      && (currentTurn === playerColor)
      && (capturedPieces[playerColor].length > 0)
      && !isResurrectionMode;

    resurrectBtn.disabled = !can;
    resurrectBtn.style.display = 'inline-block';
  }

  function clearSelection() {
    selected = null;
    legalHints = new Set();
    captureHints = new Set();
  }

  // ---------- Move Rules (basic) ----------
  function getLegalMoves(fromIdx) {
    const p = pieceAt(fromIdx);
    if (!p) return {moves:new Set(), captures:new Set()};

    const {r,c} = idxToRC(fromIdx);
    const moves = new Set();
    const captures = new Set();

    const addRay = (dr,dc) => {
      let rr=r+dr, cc=c+dc;
      while(inBounds(rr,cc)){
        const to = rcToIdx(rr,cc);
        const q = pieceAt(to);
        if (!q) moves.add(to);
        else { if (q.color !== p.color) captures.add(to); break; }
        rr += dr; cc += dc;
      }
    };

    if (p.type === 'pawn') {
      const dir = (p.color === 'white') ? -1 : 1;
      const startRow = (p.color === 'white') ? 6 : 1;

      const f1r = r + dir;
      if (inBounds(f1r,c)) {
        const f1 = rcToIdx(f1r,c);
        if (!pieceAt(f1)) moves.add(f1);
      }
      const f2r = r + 2*dir;
      if (r === startRow && inBounds(f2r,c)) {
        const f1 = rcToIdx(r+dir,c);
        const f2 = rcToIdx(f2r,c);
        if (!pieceAt(f1) && !pieceAt(f2)) moves.add(f2);
      }
      for (const dc of [-1, 1]) {
        const rr = r + dir, cc = c + dc;
        if (!inBounds(rr,cc)) continue;
        const to = rcToIdx(rr,cc);
        const q = pieceAt(to);
        if (q && q.color !== p.color) captures.add(to);
      }
    }

    if (p.type === 'knight') {
      const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (const [dr,dc] of deltas) {
        const rr=r+dr, cc=c+dc;
        if (!inBounds(rr,cc)) continue;
        const to = rcToIdx(rr,cc);
        const q = pieceAt(to);
        if (!q) moves.add(to);
        else if (q.color !== p.color) captures.add(to);
      }
    }

    if (p.type === 'bishop' || p.type === 'queen') {
      addRay(-1,-1); addRay(-1,1); addRay(1,-1); addRay(1,1);
    }
    if (p.type === 'rook' || p.type === 'queen') {
      addRay(-1,0); addRay(1,0); addRay(0,-1); addRay(0,1);
    }

    // ★キングが複数でも“通常キングと同じ”に動く（特別扱いなし）
    if (p.type === 'king') {
      for (let dr=-1; dr<=1; dr++){
        for (let dc=-1; dc<=1; dc++){
          if (dr===0 && dc===0) continue;
          const rr=r+dr, cc=c+dc;
          if (!inBounds(rr,cc)) continue;
          const to = rcToIdx(rr,cc);
          const q = pieceAt(to);
          if (!q) moves.add(to);
          else if (q.color !== p.color) captures.add(to);
        }
      }
    }

    return {moves, captures};
  }

  function movePiece(fromIdx, toIdx) {
    const p = pieceAt(fromIdx);
    const q = pieceAt(toIdx);
    if (q) capturedPieces[q.color].push(q);
    board[toIdx] = p;
    board[fromIdx] = null;
  }

  function switchTurn() {
    currentTurn = opposite(currentTurn);
    updateTurnUI();
    updateResurrectButtonState();
    maybeAIMove();
  }

  // ---------- Resurrection ----------
  function enterResurrectionMode() {
    if (!playerColor) return;
    if (currentTurn !== playerColor) return;
    if (capturedPieces[playerColor].length === 0) return;

    isResurrectionMode = true;
    selectedCapturedPiece = null;
    clearSelection();
    renderBoard();
    renderCapturedPieces();
    updateResurrectButtonState();

    messageEl.textContent = '転生させたい駒（捕獲済み）をタップしてください。';
  }

  function cancelResurrection() {
    isResurrectionMode = false;
    selectedCapturedPiece = null;
    messageEl.textContent = '';
    renderCapturedPieces();
    updateResurrectButtonState();
  }

  // King 2% / Queen 6% / 残り92%をR/B/Nで均等
  function getRandomResurrectionType() {
    const r = Math.random();
    if (r < 0.02) return 'king';
    if (r < 0.08) return 'queen';
    const t = (r - 0.08) / 0.92;
    if (t < 1/3) return 'rook';
    if (t < 2/3) return 'bishop';
    return 'knight';
  }

  function handleResurrectionPlacement(toIdx) {
    if (!isResurrectionMode) return;

    if (!selectedCapturedPiece) {
      messageEl.textContent = '先に転生させたい駒（捕獲済み）をタップしてください。';
      return;
    }
    if (pieceAt(toIdx)) {
      messageEl.textContent = 'そこは空きマスではありません。空いているマスをタップしてください。';
      return;
    }

    const newType = getRandomResurrectionType();
    board[toIdx] = { type: newType, color: playerColor };

    // 捕獲リストから1個消費
    const list = capturedPieces[playerColor];
    const k = list.indexOf(selectedCapturedPiece);
    if (k !== -1) list.splice(k, 1);

    // 状態リセット
    isResurrectionMode = false;
    selectedCapturedPiece = null;
    messageEl.textContent = '';

    renderCapturedPieces();
    clearSelection();
    renderBoard();
    switchTurn();
  }

  // ---------- AI ----------
  function getAllLegalMovesForColor(color) {
    const all = [];
    for (let i=0;i<64;i++){
      const p = pieceAt(i);
      if (!p || p.color !== color) continue;
      const {moves, captures} = getLegalMoves(i);
      for (const to of captures) all.push({from:i, to, isCapture:true});
      for (const to of moves) all.push({from:i, to, isCapture:false});
    }
    return all;
  }

  function aiPickMove(color) {
    const moves = getAllLegalMovesForColor(color);
    if (moves.length === 0) return null;
    const caps = moves.filter(m => m.isCapture);
    const pool = caps.length ? caps : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function maybeAIMove() {
    if (!playerColor) return;
    if (currentTurn !== aiColor) return;
    if (isResurrectionMode) return;

    setTimeout(() => {
      if (currentTurn !== aiColor) return;
      if (isResurrectionMode) return;

      const mv = aiPickMove(aiColor);
      if (!mv) return;

      movePiece(mv.from, mv.to);
      clearSelection();
      renderCapturedPieces();
      renderBoard();
      switchTurn();
    }, 250);
  }

  // ---------- Input (board) ----------
  // スマホで click が不安定なことがあるので pointerup を主に使う
  function onBoardPointerUp(ev) {
    ev.preventDefault();

    const sq = ev.target.closest('.sq');
    if (!sq) return;

    const idx = Number(sq.dataset.index);
    if (!Number.isFinite(idx)) {
      messageEl.textContent = '内部エラー: マス番号が取得できませんでした。';
      return;
    }

    // AIの番は無効
    if (playerColor && currentTurn === aiColor) return;

    // 転生最優先
    if (isResurrectionMode) {
      handleResurrectionPlacement(idx);
      return;
    }

    const p = pieceAt(idx);

    // 選択中 → 合法なら移動
    if (selected !== null && (legalHints.has(idx) || captureHints.has(idx))) {
      movePiece(selected, idx);
      clearSelection();
      renderCapturedPieces();
      renderBoard();
      switchTurn();
      return;
    }

    // 選択し直し
    if (!p) {
      clearSelection();
      renderBoard();
      return;
    }
    if (p.color !== currentTurn) return;
    if (p.color !== playerColor) return;

    selected = idx;
    const {moves, captures} = getLegalMoves(idx);
    legalHints = moves;
    captureHints = captures;
    renderBoard();
  }

  // ---------- Start / Reset ----------
  function startGame(color) {
    playerColor = color;
    aiColor = opposite(color);

    currentTurn = 'white';
    capturedPieces.white = [];
    capturedPieces.black = [];
    isResurrectionMode = false;
    selectedCapturedPiece = null;
    clearSelection();

    initBoard();
    renderBoard();
    renderCapturedPieces();
    updateTurnUI();
    messageEl.textContent = '';

    setupContainer.style.display = 'none';
    gameContainer.style.display = 'block';

    resurrectBtn.style.display = 'inline-block';
    updateResurrectButtonState();

    maybeAIMove();
  }

  function resetGame() {
    playerColor = null;
    aiColor = null;
    currentTurn = 'white';
    capturedPieces.white = [];
    capturedPieces.black = [];
    isResurrectionMode = false;
    selectedCapturedPiece = null;
    clearSelection();

    resurrectBtn.style.display = 'inline-block';
    resurrectBtn.disabled = true;

    messageEl.textContent = '';
    turnEl.textContent = '';

    gameContainer.style.display = 'none';
    setupContainer.style.display = 'flex';

    boardEl.innerHTML = '';
    capWhiteEl.innerHTML = '';
    capBlackEl.innerHTML = '';
  }

  // ---------- Wire up ----------
  // 重要：pointerup を使う（clickだけだと環境によって取りこぼすことがある）
  messageEl.textContent = '盤面タップ検知: ' + new Date().toLocaleTimeString();
  boardEl.addEventListener('pointerup', onBoardPointerUp, { passive: false });

  // 念のため click でも同じ処理を呼ぶ（古いブラウザ/挙動差対策）
  boardEl.addEventListener('click', (ev) => {
    // pointerup が来ない環境用のフォールバック
    onBoardPointerUp(ev);
  });

  startWhiteBtn.addEventListener('click', () => startGame('white'));
  startBlackBtn.addEventListener('click', () => startGame('black'));
  resetBtn.addEventListener('click', resetGame);
  resurrectBtn.addEventListener('click', enterResurrectionMode);

  // キャンセル操作を残すなら、長押し等に割り当ててもOK。ここでは“転生ボタン長押し”代わりに右クリック等は省略。
  // ひとまずUI上キャンセルしたいなら、リセットか、転生ボタンをもう一度押す運用でもOK。
  // ただし「キャンセルボタン」がHTMLにあるなら生かす：
  if (cancelResBtn) cancelResBtn.addEventListener('click', cancelResurrection);

  resetGame();
})();
