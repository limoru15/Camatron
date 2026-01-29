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
// DAILY (reseta na virada do dia)
if (cmd === "!daily") {
  if (canManageMessages(msg)) await safeDelete(msg);

  const now = new Date();
  const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const lastDay = data.lastDaily[msg.author.id];

  if (lastDay === today) {
    await sendAndAutoDelete(
      msg.channel,
      `⏳ ${msg.author}, tu já pegou os tokens hoje.`
    );
    return;
  }

  const user = getUser(data, msg.author.id);
  user.tokens += 5;
  data.lastDaily[msg.author.id] = today;
  saveData(data);

  await sendAndAutoDelete(
    msg.channel,
    `🎉 ${msg.author}, +5 tokens!`
  );
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
  // CASSINO (justo, com “escadinha” no ruim e 0 sendo o mais raro)
  // Uso: !cassino X
  if (cmd === "!cassino") {
    if (canManageMessages(msg)) await safeDelete(msg);

    const bet = parseInt(args[0], 10);
    if (!bet || bet < CASINO_MIN_BET) {
      await sendAndAutoDelete(msg.channel, `🎰 ${msg.author}, aposta mínima é ${CASINO_MIN_BET} tokens.`);
      return;
    }

    const user = getUser(data, msg.author.id);
    if (user.tokens < bet) {
      await sendAndAutoDelete(msg.channel, `❌ ${msg.author}, tokens insuficientes.`);
      return;
    }

    // --- Helpers ---
    const clampInt = (n) => Math.max(0, Math.floor(n));
    const cap10000 = (n) => Math.min(10000, clampInt(n));

    function weightedPick(table) {
      const sum = table.reduce((a, b) => a + b.p, 0);
      let r = Math.random() * sum;
      for (const it of table) {
        r -= it.p;
        if (r <= 0) return it.payout;
      }
      return table[table.length - 1].payout;
    }

    // Retorna uma tabela de probabilidades (p somando 1.00)
    // payout = TOTAL recebido após a aposta (ou seja, saldo muda em payout - bet)
    function buildCasinoTable(bet) {
      // Caso especial: bet <= 7 (estilo “aposta 5”)
      if (bet <= 7) {
        // Ruim (55%): 45% -> bet | 9% -> 0 | 1% -> bet*2 (milagre no ruim)
        // Bom (45%): degraus pra cima
        const b2 = cap10000(bet * 2);
        return [
          { p: 0.45, payout: bet },
          { p: 0.09, payout: 0 },
          { p: 0.01, payout: b2 },

          { p: 0.25, payout: b2 },
          { p: 0.10, payout: cap10000(bet * 5) },   // ~25 quando bet=5
          { p: 0.05, payout: cap10000(bet * 10) },  // ~50 quando bet=5
          { p: 0.03, payout: cap10000(bet * 20) },  // ~100 quando bet=5
          { p: 0.015, payout: cap10000(bet * 50) }, // ~250 quando bet=5
          { p: 0.005, payout: cap10000(bet * 100) } // ~500 quando bet=5
        ];
      }

      // Caso: bet <= 20 (estilo “aposta 10”)
      if (bet <= 20) {
        // Ruim (55%): 35% -> bet | 15% -> half | 5% -> 0
        // Bom (45%): 20->2x, 12->2.5x, 8->5x, 3->10x, 1.5->25x, 0.4->50x, 0.1->100x
        const half = clampInt(bet / 2);
        return [
          { p: 0.35, payout: bet },
          { p: 0.15, payout: half },
          { p: 0.05, payout: 0 },

          { p: 0.20, payout: cap10000(bet * 2) },
          { p: 0.12, payout: cap10000(bet * 2.5) },
          { p: 0.08, payout: cap10000(bet * 5) },
          { p: 0.03, payout: cap10000(bet * 10) },
          { p: 0.015, payout: cap10000(bet * 25) },
          { p: 0.004, payout: cap10000(bet * 50) },
          { p: 0.001, payout: cap10000(bet * 100) }
        ];
      }

      // Caso: bet <= 75 (estilo “aposta 50”)
      if (bet <= 75) {
        const half = clampInt(bet / 2);
        // Ruim (55%): 30% bet | 14% half | 7% 10 | 3% 5 | 1% 0
        // Bom (45%): 18% 2x | 10% 3x | 7% 5x | 5% 10x | 3% 15x | 1.5% 20x | 0.4% 40x | 0.1% 100x
        return [
          { p: 0.30, payout: bet },
          { p: 0.14, payout: half },
          { p: 0.07, payout: 10 },
          { p: 0.03, payout: 5 },
          { p: 0.01, payout: 0 },

          { p: 0.18, payout: cap10000(bet * 2) },
          { p: 0.10, payout: cap10000(bet * 3) },
          { p: 0.07, payout: cap10000(bet * 5) },
          { p: 0.05, payout: cap10000(bet * 10) },
          { p: 0.03, payout: cap10000(bet * 15) },
          { p: 0.015, payout: cap10000(bet * 20) },
          { p: 0.004, payout: cap10000(bet * 40) },
          { p: 0.001, payout: cap10000(bet * 100) }
        ];
      }

      // Caso: bet <= 200 (estilo “aposta 100”)
      if (bet <= 200) {
        const half = clampInt(bet / 2);
        // Ruim (55%): 25% bet | 15% half | 10% 10 | 4% 5 | 1% 0
        // Bom (45%): 15% 1.5x | 10% 2.5x | 8% 5x | 6% 7.5x | 4% 10x | 1.5% 20x | 0.4% 50x | 0.1% 100x
        return [
          { p: 0.25, payout: bet },
          { p: 0.15, payout: half },
          { p: 0.10, payout: 10 },
          { p: 0.04, payout: 5 },
          { p: 0.01, payout: 0 },

          { p: 0.15, payout: cap10000(bet * 1.5) },
          { p: 0.10, payout: cap10000(bet * 2.5) },
          { p: 0.08, payout: cap10000(bet * 5) },
          { p: 0.06, payout: cap10000(bet * 7.5) },
          { p: 0.04, payout: cap10000(bet * 10) },
          { p: 0.015, payout: cap10000(bet * 20) },
          { p: 0.004, payout: cap10000(bet * 50) },
          { p: 0.001, payout: cap10000(bet * 100) }
        ];
      }

      // Caso: bet > 200 (estilo “aposta 1000” com escalas)
      {
        const p0_75 = clampInt(bet * 0.75);
        const p0_50 = clampInt(bet * 0.50);
        const p0_25 = clampInt(bet * 0.25);

        // Ruim (55%): 30% bet | 18% 0.75bet | 5% 0.5bet | 1% 0.25bet | 1% 0
        // Bom (45%): 20% 1.5x | 12% 2x | 7% 3x | 4% 5x | 1.5% 7.5x | 0.5% 10x (cap 10000)
        return [
          { p: 0.30, payout: bet },
          { p: 0.18, payout: p0_75 },
          { p: 0.05, payout: p0_50 },
          { p: 0.01, payout: p0_25 },
          { p: 0.01, payout: 0 },

          { p: 0.20, payout: cap10000(bet * 1.5) },
          { p: 0.12, payout: cap10000(bet * 2) },
          { p: 0.07, payout: cap10000(bet * 3) },
          { p: 0.04, payout: cap10000(bet * 5) },
          { p: 0.015, payout: cap10000(bet * 7.5) },
          { p: 0.005, payout: cap10000(bet * 10) }
        ];
      }
    }

    // --- Cobra aposta, sorteia payout ---
    user.tokens -= bet;

    const table = buildCasinoTable(bet);
    const payout = weightedPick(table);

    user.tokens += payout;
    saveData(data);

    const delta = payout - bet;
    const deltaText = delta >= 0 ? `+${delta}` : `${delta}`;

    await sendAndAutoDelete(
      msg.channel,
      `🎰 ${msg.author} apostou **${bet}**.\n` +
      `Resultado: **${payout}** (${deltaText})\n` +
      `💰 Saldo: **${user.tokens}**`
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








