import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import mineflayer from 'mineflayer';
import OpenAI from 'openai';

// === Настройки ===
const MEMORY_FILE = path.join(process.cwd(), 'botMemory.json');
const CHARACTER_FILE = path.join(process.cwd(), 'character.txt');
const PLAYERNAME = process.env.PLAYERNAME || 'Player';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = 'gpt-5'; // или другой подходящий
const PROMPT_TEMPLATE = fs.readFileSync('prompt.txt', 'utf8');

// Простая функция логирования с меткой времени
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

log('Загружены переменные окружения из .env:', OPENAI_API_KEY ? 'OPENAI_API_KEY — установлен' : 'OPENAI_API_KEY — отсутствует');

// === Функции работы с памятью ===
function loadMemory() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      log('Файл памяти не найден, инициализируем пустой памятью.');
      return [];
    }
    const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
    if (!raw || !raw.trim()) {
      log('Файл памяти существует, но пустой — используем пустой массив.');
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      log('⚠️ Формат файла памяти неверный (не массив) — сбрасываем в пустой массив.');
      return [];
    }
    return parsed;
  } catch (e) {
    log('❌ Ошибка при чтении/парсинге файла памяти:', e.message);
    // попытка сделать бэкап повреждённого файла
    try {
      const backupName = MEMORY_FILE + `.corrupt-${Date.now()}`;
      fs.renameSync(MEMORY_FILE, backupName);
      log(`Файл памяти переименован в бэкап: ${backupName}`);
    } catch (er) {
      log('Не удалось создать бэкап файла памяти:', er.message);
    }
    return [];
  }
}

function saveMemory(memoryArray) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryArray, null, 2), 'utf8');
    log('Память сохранена. Текущий размер:', memoryArray.length);
  } catch (e) {
    log('❌ Ошибка при сохранении памяти:', e.message);
  }
}

function appendMemory(newMemory) {
  if (!newMemory || !String(newMemory).trim()) return;
  const mem = loadMemory();
  mem.push(String(newMemory).trim());
  // опционально: ограничение размера (например, 200 записей)
  const MAX_MEM = 200;
  if (mem.length > MAX_MEM) mem.splice(0, mem.length - MAX_MEM);
  saveMemory(mem);
}

function getMemoryString() {
  const mem = loadMemory();
  if (!mem.length) return '';
  return mem.join('\n');
}

function getCharacterDescription() {
  if (!fs.existsSync(CHARACTER_FILE)) return 'Описание характера отсутствует.';
  const raw = fs.readFileSync(CHARACTER_FILE, 'utf8').trim();
  return raw || 'Описание характера пусто.';
}

// === Безопасная проверка кода ===
function isCodeSafe(code) {
  if (!code || typeof code !== 'string') return false;
  const lowered = code.toLowerCase();
  const forbidden = [
    'fs.', 'path.', 'child_process', 'process.exit', 'eval(', 'require(',
    'http.', 'https.', 'spawn(', 'exec(', 'writefile', 'readfile', 'unlink', 'rmdir', 'mkdir',
    'process.env', 'process.', 'import(', 'await import'
  ];
  return !forbidden.some(bad => lowered.includes(bad));
}

// === Запрос к OpenAI ===
async function askBot(message) {
  const memoryText = getMemoryString();
  const characterText = getCharacterDescription();

  log('📩 Получено сообщение от игрока:', message);
  log('🧠 Память бота (строка):', memoryText ? '(есть содержимое)' : '(память пуста)');
  if (memoryText) log(memoryText);
  log('🎭 Характер бота:\n', characterText);

  const prompt = PROMPT_TEMPLATE
    .replace('{{CHARACTER}}', characterText)
    .replace('{{MEMORY}}', memoryText || 'Память пуста.')
    .replace('@@@', message);

  log('\n📝 Отправляем в OpenAI промпт (обрезано до 5000 символов в логе):\n', prompt.slice(0, 5000));

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY не задан в окружении. Проверьте .env файл.');
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const response = await openai.responses.create({
    model: MODEL,
    input: prompt
  });

  // В зависимости от версии SDK структура ответа может отличаться — пытаемся безопасно извлечь текст
  const text = (response.output_text || response.output?.[0]?.content?.[0]?.text || JSON.stringify(response)).toString().trim();
  log('\n📦 Ответ от OpenAI (сырой, первые 2000 символов):\n', text.slice(0, 2000));

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Ответ не является корректным JSON. Сырой ответ (обрезан): ${text.slice(0, 1000)}`);
  }

  log('\n✅ Разобранный JSON:\n', parsed);

  if (!parsed.code) throw new Error('В ответе нет поля "code"');
  if (!isCodeSafe(parsed.code)) throw new Error('Код содержит запрещённые конструкции — выполнение отменено.');

  if (parsed.memory) {
    appendMemory(parsed.memory);
    log('Добавлено в память новое значение:', parsed.memory);
  }

  return parsed.code;
}

// === Mineflayer бот ===
const bot = mineflayer.createBot({
  host: 'localhost',
  username: 'Bot'
});

bot.on('spawn', () => {
  log('Бот заспавнился на сервере.');
});

bot.on('chat', async (username, message) => {
  if (username === bot.username) return;
  if (username !== PLAYERNAME) return;

  try {
    const code = await askBot(message);
    log('\n🚀 Выполняем код (обрезано до 2000 символов в логе):\n', code.slice(0, 2000));
    // Выполняем код — предполагается, что код использует объект bot
    eval(code);
  } catch (err) {
    log('\n❌ Ошибка:', err.message);
    try {
      bot.chat(`Ошибка: ${err.message}`);
    } catch (e) {
      log('Не удалось отправить сообщение об ошибке в чат:', e.message);
    }
  }
});
