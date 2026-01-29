const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

// ==============================
// TOKEN (VEM DO RENDER / AMBIENTE)
// ==============================
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.log("❌ DISCORD_TOKEN não definido.");
  process.exit(1);
}

// ==============================
// CONFIGURAÇÕES
// ==============================
const BOT_CHANNEL_ID = "1465997947064815739"; // canal do bot
const ADMIN_ROLE_NAME = "ADM Camatron";       // cargo admin

const VOTE_DURATION_MS = 5 * 60 * 1000;       // 5 minutos
const MIN_VOTES = 5;                          // mínimo de votos
const CLEANUP_DELAY_MS = 15 * 1000;           // apaga msg do bot depois de 15s

const CASINO_MIN_BET = 5;                     // aposta mínima

// ==============================
// CLIENTE
// ==============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// ==============================
// DADOS
// ==============================
const DATA_FILE = "./data.json";

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ users: {}, lastDaily: {} }, null, 2)
    );
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function getUser(data, id) {
  if (!data.users[id]) data.users[id] = { tokens: 0 };
  return data.users[id];
}
function hasAdminRole(member) {
  return member.roles.cache.some(r => r.name === ADMIN_ROLE_NAME);
}
function canManageMessages(msg) {
  return msg.guild?.members?.me?.permissions?.has("ManageMessages");
}
async function safeDelete(message) {
  try { await message.delete(); } catch (_) {}
}

// ✅ não derruba o bot se der erro de permissão
async function sendAndAutoDelete(channel, content) {
  try {
    const m = await channel.send(content);
    setTimeout(() => safeDelete(m), CLEANUP_DELAY_MS);
    return m;
  } catch (e) {
    console.log("⚠️ Falha ao enviar mensagem:", e?.code || e);
    return null;
  }
}

// ==============================
// CASTIGOS (minutos)
// ==============================
const punishments = {
  "1": 1,
  "5": 5,
  "10": 10,
  "60": 60,
  "1440": 1440,   // 24h
  "10080": 10080  // 7 dias
};

client.once("ready", () => {
  console.log(`✅ Camatron online como ${client.user.tag}`);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== BOT_CHANNEL_ID) return;

  const args = msg.content.trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  const data = loadData();

  // ==============================
  // HELP (manda no privado e apaga comando no canal)
  if (cmd === "!help") {
    if (canManageMessages(msg)) await safeDelete(msg);

    const helpText =
      "**📜 Comandos do Camatron**\n\n" +
      "`!daily` → ganha 5 tokens\n" +
      "`!tokens` → vê teus tokens\n" +
      "`!cassino X` → aposta X tokens (mínimo 5)\n" +
      "`!punir @user <tempo>` → inicia votação\n" +
      "`!punir @user <tempo> anon` → votação anônima (custo dobrado)\n\n" +
      "**Tempos:** 1, 5, 10, 60, 1440, 10080\n\n" +
      "**ADM Camatron:**\n" +
      "`!addtokens @user X`\n" +
      "`!removetokens @user X`\n" +
      "`!checktokens @user'\n" +
      "`!resetdaily @user`";


    try {
      await msg.author.send(helpText);
      await sendAndAutoDelete(msg.channel, `📩 ${msg.author}, te mandei o help no privado.`);
    } catch {
      await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, não consegui te mandar DM. Libera DM do servidor.`);
    }
    return;
  }

  // ==============================
  // DAILY
  if (cmd === "!daily") {
    if (canManageMessages(msg)) await safeDelete(msg);

    const last = data.lastDaily[msg.author.id] || 0;
    const now = Date.now();
    if (now - last < 86400000) {
      await sendAndAutoDelete(msg.channel, `⏳ ${msg.author}, tu já pegou os tokens hoje.`);
      return;
    }

    const user = getUser(data, msg.author.id);
    user.tokens += 5;
    data.lastDaily[msg.author.id] = now;
    saveData(data);

    await sendAndAutoDelete(msg.channel, `🎉 ${msg.author}, +5 tokens!`);
    return;
  }

  // ==============================
  // TOKENS (próprio)
  if (cmd === "!tokens") {
    if (canManageMessages(msg)) await safeDelete(msg);

    const user = getUser(data, msg.author.id);
    await sendAndAutoDelete(msg.channel, `💰 ${msg.author}, tu tem **${user.tokens} tokens**.`);
    return;
  }

  // ==============================
  // CHECKTOKENS (ADM vê tokens dos outros)
  if (cmd === "!checktokens") {
    if (canManageMessages(msg)) await safeDelete(msg);

    if (!hasAdminRole(msg.member)) {
      await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, só quem tem o cargo **ADM Camatron**.`);
      return;
    }

    const targetId = args[0]?.replace(/[<@!>]/g, "");
    if (!targetId) {
      await sendAndAutoDelete(msg.channel, "Uso: `!checktokens @user`");
      return;
    }

    const u = getUser(data, targetId);
    await sendAndAutoDelete(msg.channel, `💰 <@${targetId}> tem **${u.tokens} tokens**.`);
    return;
  }
  
// ==============================
// RESET DAILY (ADM)
if (cmd === "!resetdaily") {
  if (canManageMessages(msg)) await safeDelete(msg);

  if (!hasAdminRole(msg.member)) {
    await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, só quem tem o cargo **ADM Camatron**.`);
    return;
  }

  const targetId = args[0]?.replace(/[<@!>]/g, "");
  if (!targetId) {
    await sendAndAutoDelete(msg.channel, "Uso: `!resetdaily @user`");
    return;
  }

  delete data.lastDaily[targetId];
  saveData(data);

  await sendAndAutoDelete(
    msg.channel,
    `🔄 Daily de <@${targetId}> resetado.`
  );
  return;
}

  // ==============================
  // ADD / REMOVE TOKENS (ADM)
  if (cmd === "!addtokens" || cmd === "!removetokens") {
    if (canManageMessages(msg)) await safeDelete(msg);

    if (!hasAdminRole(msg.member)) {
      await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, só quem tem o cargo **ADM Camatron**.`);
      return;
    }

    const userId = args[0]?.replace(/[<@!>]/g, "");
    const amount = parseInt(args[1], 10);

    if (!userId || isNaN(amount)) {
      await sendAndAutoDelete(msg.channel, "Uso: `!addtokens @user 100` ou `!removetokens @user 100`");
      return;
    }

    const user = getUser(data, userId);
    if (cmd === "!addtokens") user.tokens += amount;
    else user.tokens = Math.max(0, user.tokens - amount);

    saveData(data);
    await sendAndAutoDelete(msg.channel, `✅ Tokens do <@${userId}> atualizados.`);
    return;
  }

  // ==============================
// CASSINO PROGRESSIVO (SEM CAP)
// Uso: !cassino X
if (cmd === "!cassino") {
  if (canManageMessages(msg)) await safeDelete(msg);

  const bet = parseInt(args[0], 10);
  if (!bet || bet < CASINO_MIN_BET) {
    await sendAndAutoDelete(
      msg.channel,
      `🎰 ${msg.author}, aposta mínima é ${CASINO_MIN_BET} tokens.`
    );
    return;
  }

  const user = getUser(data, msg.author.id);
  if (user.tokens < bet) {
    await sendAndAutoDelete(
      msg.channel,
      `❌ ${msg.author}, tokens insuficientes.`
    );
    return;
  }

  // desconta aposta
  user.tokens -= bet;

  // fator linear (do jeito que tu descreveu)
  const factor = bet / 100;

  // probabilidades base + crescimento suave
  let chances = [
    { p: 0.70 - 0.002 * factor, win: 0 },
    { p: 0.20 + 0.0005 * factor, win: 5 },
    { p: 0.07 + 0.0008 * factor, win: 10 },
    { p: 0.02 + 0.0005 * factor, win: 60 },
    { p: 0.009 + 0.00015 * factor, win: 1440 },
    { p: 0.001 + 0.00005 * factor, win: 10080 }
  ];

  // evita números negativos
  chances = chances.map(c => ({
    win: c.win,
    p: Math.max(0, c.p)
  }));

  // normaliza (soma = 1)
  const total = chances.reduce((s, c) => s + c.p, 0);
  chances.forEach(c => (c.p /= total));

  // sorteio
  const r = Math.random();
  let acc = 0;
  let result = 0;

  for (const c of chances) {
    acc += c.p;
    if (r <= acc) {
      result = c.win;
      break;
    }
  }

  // aplica ganho
  user.tokens += result;
  saveData(data);

  await sendAndAutoDelete(
    msg.channel,
    `🎰 ${msg.author} apostou **${bet}** tokens.\n` +
      (result === 0
        ? "💥 Perdeu tudo."
        : `🎉 Ganhou **${result} tokens**!`) +
      `\n💰 Saldo: **${user.tokens}**`
  );
  return;
}


  // ==============================
  // PUNIR (votação)
  if (cmd === "!punir") {
    if (canManageMessages(msg)) await safeDelete(msg);

    const targetId = args[0]?.replace(/[<@!>]/g, "");
    const minutes = args[1];
    const anon = args[2] === "anon";

    if (!targetId || !punishments[minutes]) {
      await sendAndAutoDelete(msg.channel, "Uso: `!punir @user 5` ou `!punir @user 5 anon`");
      return;
    }

    const cost = punishments[minutes] * (anon ? 2 : 1);
    const opener = getUser(data, msg.author.id);

    if (opener.tokens < cost) {
      await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, tokens insuficientes.`);
      return;
    }

    opener.tokens -= cost;
    saveData(data);

    const poll = await msg.channel.send(
      `⚖ **Votação de castigo (5 min)**\n` +
      `Alvo: <@${targetId}>\n` +
      `Tempo: ${minutes} min\n` +
      `${anon ? "🔒 Anônima" : `Autor: ${msg.author}`}\n` +
      `👍 SIM | 👎 NÃO\n` +
      `🗳 Mínimo: ${MIN_VOTES} votos`
    );

    await poll.react("👍");
    await poll.react("👎");

    setTimeout(async () => {
      const fetched = await poll.fetch();
      const yes = (fetched.reactions.cache.get("👍")?.count || 1) - 1;
      const no  = (fetched.reactions.cache.get("👎")?.count || 1) - 1;
      const total = yes + no;

      if (total < MIN_VOTES) {
        const d2 = loadData();
        getUser(d2, msg.author.id).tokens += cost;
        saveData(d2);

        await sendAndAutoDelete(msg.channel, `❌ Votação inválida (<${MIN_VOTES} votos). Tokens devolvidos para ${msg.author}.`);
        setTimeout(() => safeDelete(fetched), CLEANUP_DELAY_MS);
        return;
      }

      if (yes > no) {
        try {
          const member = await msg.guild.members.fetch(targetId);
          await member.timeout(punishments[minutes] * 60 * 1000);
          await sendAndAutoDelete(msg.channel, `✅ Aprovado. <@${targetId}> levou ${minutes} min de castigo.`);
        } catch {
          await sendAndAutoDelete(msg.channel, "❌ Não consegui aplicar o timeout (permissões/hierarquia).");
        }
      } else {
        await sendAndAutoDelete(msg.channel, `❌ Rejeitado. <@${targetId}> não levou castigo.`);
      }

      setTimeout(() => safeDelete(fetched), CLEANUP_DELAY_MS);
    }, VOTE_DURATION_MS);

    return;
  }
});

client.login(TOKEN);





