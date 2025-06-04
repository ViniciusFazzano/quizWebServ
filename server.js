


const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const WebSocket = require('ws');


const QUESTIONS_FILE = path.join(__dirname, 'questions.json');
let originalQuestions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}


let questions = [];            
let clients   = new Map();     
let currentQuestionIndex = -1;
let questionAnswered     = false;
let questionTimeout      = null;
let quizStarted          = false; 


function initQuestions() {
  questions = originalQuestions.slice();
  shuffleArray(questions);
}


function resetScores() {
  for (let [ws, info] of clients) {
    info.score = 0;
  }
}


function broadcast(obj) {
  const mensagem = JSON.stringify(obj);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(mensagem);
    }
  });
}


function nextQuestion() {
  
  if (questionTimeout) {
    clearTimeout(questionTimeout);
    questionTimeout = null;
  }

  currentQuestionIndex++;
  questionAnswered = false;

  if (currentQuestionIndex >= questions.length) {
    
    const scoreboard = Array.from(clients.values())
      .map(({ name, score }) => ({ name, score }))
      .sort((a, b) => b.score - a.score);

    broadcast({ type: 'game_over', scoreboard });
    console.log('Quiz finalizado. Placar enviado a todos:');
    console.table(scoreboard);

    
    quizStarted = false;
    return;
  }

  
  const q = questions[currentQuestionIndex];
  broadcast({
    type: 'question',
    questionIndex: currentQuestionIndex,
    question: q.question,
    options:  q.options
  });
  console.log(`Pergunta #${currentQuestionIndex + 1}: ${q.question}`);

  
  questionTimeout = setTimeout(() => {
    if (!questionAnswered) {
      broadcast({
        type: 'info',
        message: 'Ninguém respondeu corretamente a tempo. Pulando pergunta...'
      });
      setTimeout(nextQuestion, 2000);
    }
  }, 15000);
}


const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'client.html');
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500);
        return res.end('Erro ao carregar a página.');
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else {
    res.writeHead(404);
    res.end('404 - Não encontrado');
  }
});


initQuestions();


const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Novo cliente WS conectado.');

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      console.warn('JSON inválido recebido:', msg);
      return;
    }

    
    if (data.type === 'register') {
      const nome = String(data.name || '').trim();
      if (!nome) {
        ws.send(JSON.stringify({ type: 'error', message: 'Nome inválido.' }));
        return;
      }
      clients.set(ws, { name: nome, score: 0 });
      console.log(`Jogador registrado: ${nome}`);

      broadcast({ type: 'info', message: `Jogador "${nome}" entrou no quiz.` });
      return;
    }

    
    if (data.type === 'start') {
      
      if (!quizStarted) {
        quizStarted = true;
        console.log('Quiz iniciado via botão no cliente.');

        
        initQuestions();
        resetScores();
        currentQuestionIndex = -1;

        broadcast({ type: 'info', message: 'Quiz iniciado! Boa sorte a todos!' });
        
        setTimeout(nextQuestion, 1000);
      }
      return;
    }

    
    if (data.type === 'answer') {
      if (typeof data.questionIndex !== 'number' || typeof data.answerIndex !== 'number') {
        ws.send(JSON.stringify({ type: 'error', message: 'Formato de resposta inválido.' }));
        return;
      }

      
      if (data.questionIndex !== currentQuestionIndex) {
        return;
      }
      
      if (questionAnswered) {
        return;
      }

      const jogador = clients.get(ws);
      if (!jogador) {
        ws.send(JSON.stringify({ type: 'error', message: 'Você não se registrou.' }));
        return;
      }

      const corretoIndex = questions[currentQuestionIndex].answerIndex;
      if (data.answerIndex === corretoIndex) {
        
        questionAnswered = true;
        jogador.score += 1;
        console.log(`"${jogador.name}" acertou a pergunta #${currentQuestionIndex + 1}!`);

        broadcast({
          type: 'answered',
          winner: jogador.name,
          correctOption: questions[currentQuestionIndex].options[corretoIndex]
        });

        
        clearTimeout(questionTimeout);
        setTimeout(nextQuestion, 2000);
      } else {
        
        ws.send(JSON.stringify({ type: 'info', message: 'Resposta incorreta!' }));
      }
      return;
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info) {
      console.log(`Jogador desconectado: ${info.name}`);
      clients.delete(ws);
      broadcast({ type: 'info', message: `Jogador "${info.name}" saiu do quiz.` });
    }
  });
});


const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log('Espere jogadores entrarem e clique em "Iniciar Quiz" no site para começar.');
});
