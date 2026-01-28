const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

// ==============================
// COLE SEU TOKEN AQUI
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
const MIN_VOTES = 5;                           // mínimo de votos (sim + não)
const CLEANUP_DELAY_MS = 15 * 1000;           // apaga mensagens do bot depois de 15s

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
  // se o bot não tiver permissão, não quebra o código
  return msg.guild?.members?.me?.permissions?.has("ManageMessages");
}
async function safeDelete(message) {
  try { await message.delete(); } catch (_) {}
}
async function sendAndAutoDelete(channel, content) {
  const m = await channel.send(content);
  setTimeout(() => safeDelete(m), CLEANUP_DELAY_MS);
  return m;
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

  const raw = msg.content.trim();
  const args = raw.split(/\s+/);
  const cmd = args.shift()?.toLowerCase();
  const data = loadData();

  // ==============================
  // HELP (manda no privado e apaga comando no canal)
  if (cmd === "!help") {
    if (canManageMessages(msg)) await safeDelete(msg);

    const helpText =
      "**📜 Comandos do Camatron**\n\n" +
      "`!daily` → ganha 5 tokens\n" +
      "`!tokens` → vê seus tokens\n" +
      "`!punir @user <tempo>` → inicia votação\n" +
      "`!punir @user <tempo> anon` → votação anônima (custo dobrado)\n\n" +
      "**Tempos:** 1, 5, 10, 60, 1440, 10080\n\n" +
      "**ADM Camatron:**\n" +
      "`!addtokens @user X`\n" +
      "`!removetokens @user X`";

    try {
      await msg.author.send(helpText);
      await sendAndAutoDelete(msg.channel, `📩 ${msg.author}, te mandei o help no privado.`);
    } catch {
      await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, não consegui te mandar DM. Libera DM do servidor.`);
    }
    return;
  }

  // ==============================
  // DAILY (apaga comando do usuário e apaga resposta depois)
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
  // TOKENS (apaga comando do usuário e apaga resposta depois)
  if (cmd === "!tokens") {
    if (canManageMessages(msg)) await safeDelete(msg);

    const user = getUser(data, msg.author.id);
    await sendAndAutoDelete(msg.channel, `💰 ${msg.author}, tu tem **${user.tokens} tokens**.`);
    return;
  }

  // ==============================
  // ADD / REMOVE TOKENS (ADM) — apaga comando e resposta some depois
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
  // PUNIR (apaga comando do usuário; votação some no final; reembolso se <5 votos)
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

    // cobra tokens
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

      // sem votos suficientes: reembolsa
      if (total < MIN_VOTES) {
        const d2 = loadData();
        const opener2 = getUser(d2, msg.author.id);
        opener2.tokens += cost;
        saveData(d2);

        await sendAndAutoDelete(msg.channel, `❌ Votação inválida (<${MIN_VOTES} votos). Tokens devolvidos para ${msg.author}.`);
        setTimeout(() => safeDelete(fetched), CLEANUP_DELAY_MS);
        return;
      }

      // com votos suficientes: decide
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

      // limpa mensagem da votação
      setTimeout(() => safeDelete(fetched), CLEANUP_DELAY_MS);
    }, VOTE_DURATION_MS);

    return;
  }
});

client.login(TOKEN);
