const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");
const fs = require("fs");

// ==============================
// TOKEN (VEM DO HOST / AMBIENTE)
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
const MIN_VOTES = 5;                          // mínimo de votos
const CLEANUP_DELAY_MS = 15 * 1000;           // apaga msg do bot depois de 15s

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
  return member?.roles?.cache?.some(r => r.name === ADMIN_ROLE_NAME);
}

function canManageMessages(msg) {
  return msg.guild?.members?.me?.permissions?.has(PermissionsBitField.Flags.ManageMessages);
}

async function safeDelete(message) {
  try { await message.delete(); } catch (_) {}
}

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
// DAILY POR VIRADA DO DIA (SÃO PAULO)
// ==============================
function todayKeySaoPaulo() {
  const now = new Date();
  const br = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return br.toISOString().slice(0, 10); // YYYY-MM-DD
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

process.on("unhandledRejection", (err) => console.log("⚠️ unhandledRejection:", err));
client.on("error", (err) => console.log("⚠️ client error:", err));

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (msg.channel.id !== BOT_CHANNEL_ID) return;

  const args = msg.content.trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  const data = loadData();

  // ==============================
  // HELP
  if (cmd === "!help") {
    if (canManageMessages(msg)) await safeDelete(msg);

    const helpText =
      "**📜 Comandos do Camatron**\n\n" +
      "`!daily` → ganha 5 tokens (vira no 00:00)\n" +
      "`!tokens` → vê teus tokens\n" +
      "`!punir @user <tempo>` → inicia votação\n" +
      "`!punir @user <tempo> anon` → votação anônima (custo dobrado)\n\n" +
      "**Tempos:** 1, 5, 10, 60, 1440, 10080\n" +
      "**Votação:** 1min→45s | <60min→2m30 | >=60min→5m\n\n" +
      "**ADM Camatron:**\n" +
      "`!addtokens @user X`\n" +
      "`!removetokens @user X`\n" +
      "`!checktokens @user`\n" +
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
  // DAILY (vira no 00:00 São Paulo)
  if (cmd === "!daily") {
    if (canManageMessages(msg)) await safeDelete(msg);

    const today = todayKeySaoPaulo();
    const lastDay = data.lastDaily[msg.author.id];

    if (lastDay === today) {
      await sendAndAutoDelete(msg.channel, `⏳ ${msg.author}, tu já pegou os tokens hoje.`);
      return;
    }

    const user = getUser(data, msg.author.id);
    user.tokens += 5;

    data.lastDaily[msg.author.id] = today;
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
      await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, só quem tem o cargo **${ADMIN_ROLE_NAME}**.`);
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
  // RESETDAILY (ADM)
  if (cmd === "!resetdaily") {
    if (canManageMessages(msg)) await safeDelete(msg);

    if (!hasAdminRole(msg.member)) {
      await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, só quem tem o cargo **${ADMIN_ROLE_NAME}**.`);
      return;
    }

    const targetId = args[0]?.replace(/[<@!>]/g, "");
    if (!targetId) {
      await sendAndAutoDelete(msg.channel, "Uso: `!resetdaily @user`");
      return;
    }

    delete data.lastDaily[targetId];
    saveData(data);

    await sendAndAutoDelete(msg.channel, `🔄 Daily de <@${targetId}> resetado.`);
    return;
  }

  // ==============================
  // ADD / REMOVE TOKENS (ADM)
  if (cmd === "!addtokens" || cmd === "!removetokens") {
    if (canManageMessages(msg)) await safeDelete(msg);

    if (!hasAdminRole(msg.member)) {
      await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, só quem tem o cargo **${ADMIN_ROLE_NAME}**.`);
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
  // PUNIR (votação) — duração variável + não reduz timeout + reembolso
  if (cmd === "!punir") {
    if (canManageMessages(msg)) await safeDelete(msg);

    const targetId = args[0]?.replace(/[<@!>]/g, "");
    const minutesKey = args[1];
    const anon = args[2] === "anon";

    if (!targetId || !punishments[minutesKey]) {
      await sendAndAutoDelete(msg.channel, "Uso: `!punir @user 5` ou `!punir @user 5 anon`");
      return;
    }

    const minutes = punishments[minutesKey];
    const cost = minutes * (anon ? 2 : 1);

    const opener = getUser(data, msg.author.id);
    if (opener.tokens < cost) {
      await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, tokens insuficientes.`);
      return;
    }

    // duração da votação
    let voteMs, voteLabel;
    if (minutes === 1) {
      voteMs = 45 * 1000;
      voteLabel = "45s";
    } else if (minutes < 60) {
      voteMs = 150 * 1000; // 2m30
      voteLabel = "2m30";
    } else {
      voteMs = 5 * 60 * 1000;
      voteLabel = "5 min";
    }

    // cobra tokens
    opener.tokens -= cost;
    saveData(data);

    const poll = await msg.channel.send(
      `⚖ **Votação de castigo (${voteLabel})**\n` +
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

      // sem votos => reembolsa
      if (total < MIN_VOTES) {
        const d2 = loadData();
        getUser(d2, msg.author.id).tokens += cost;
        saveData(d2);

        await sendAndAutoDelete(msg.channel, `❌ Votação inválida (<${MIN_VOTES} votos). Tokens devolvidos para ${msg.author}.`);
        setTimeout(() => safeDelete(fetched), CLEANUP_DELAY_MS);
        return;
      }

      // aprovado
      if (yes > no) {
        try {
          const member = await msg.guild.members.fetch(targetId);

          const curUntil = member.communicationDisabledUntil;
          const curMs = curUntil ? (curUntil.getTime() - Date.now()) : 0;

          const newMs = minutes * 60 * 1000;
          const MARGIN_MS = 10 * 1000;

          // se já tá com castigo maior/igual => não reduz e devolve tokens
          if (curMs >= (newMs - MARGIN_MS)) {
            const d2 = loadData();
            getUser(d2, msg.author.id).tokens += cost;
            saveData(d2);

            await sendAndAutoDelete(
              msg.channel,
              `⚠️ <@${targetId}> já está com castigo **maior ou igual**. Não reduzi o timeout e devolvi **${cost} tokens** para ${msg.author}.`
            );
            setTimeout(() => safeDelete(fetched), CLEANUP_DELAY_MS);
            return;
          }

          await member.timeout(newMs);
          await sendAndAutoDelete(msg.channel, `✅ Aprovado. <@${targetId}> levou ${minutes} min de castigo.`);
        } catch (e) {
          await sendAndAutoDelete(msg.channel, "❌ Não consegui aplicar o timeout (permissões/hierarquia).");
        }
      } else {
        await sendAndAutoDelete(msg.channel, `❌ Rejeitado. <@${targetId}> não levou castigo.`);
      }

      setTimeout(() => safeDelete(fetched), CLEANUP_DELAY_MS);
    }, voteMs);

    return;
  }
});

// ✅ login fora do messageCreate
client.login(TOKEN);
