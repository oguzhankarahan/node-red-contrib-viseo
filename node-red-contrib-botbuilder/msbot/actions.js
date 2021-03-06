const { BotFrameworkAdapter, TurnContext } = require("botbuilder");
const { VBMBot } = require("./botVBM");
const getMessage = require("./messages.js");


const helper = require("node-red-viseo-helper");
const botmgr = require("node-red-viseo-bot-manager");


let adapter;
let bot;

async function initConnector(config, node, startCmd) {
  return new Promise( function (resolve, reject) {

    let botbuilderConfig = {
      appId: config.appId,
      appPassword: config.appPassword
    };

    adapter = new BotFrameworkAdapter(botbuilderConfig);
    bot = new VBMBot(node, startCmd, sendWelcomeMessage);
  
    // Handle incoming message
    bot.onMessage(async (context, next) => {
      await new Promise(function(resolve, reject) {
        receive(node, config, context);
        resolve();
      });
      await next();
    });
  
    let handleReceive = function (req, res) {
      adapter.processActivity(req, res, async context => {
        await bot.run(context);
      });
    }

    resolve({ handleReceive, reply })
  });
}

module.exports.initConnector = initConnector;

// --------------------------------------------------------------------------


function buildMessageFlow(activity) {
  // Fix
  let message = activity;
  if (!message.serviceUrl) return;

  message.user = message.from;
  message.address = { conversation: message.conversation };

  // Build data
  let data = botmgr.buildMessageFlow(
    {
      message: JSON.parse(JSON.stringify(message)),
      payload: message.text,
      user: message.from
    },
    { agent: "botbuilder" }
  );

  return data;
}

async function receive(node, config = {}, context) {
  // Log activity
  try {
    setTimeout(function() {
      helper.trackActivities(node);
    }, 0);
  } catch (err) {
    console.log(err);
  }

  let data = buildMessageFlow(context.activity);

  // Add context object to store the lifetime of the stream
  let convId = botmgr.getConvId(data);
  let ref = TurnContext.getConversationReference(context.activity);
  let _context = botmgr.getContext(data);
  _context.convRef = ref;

  // Handle Prompt
  if (botmgr.hasDelayedCallback(convId, data.message)) {
    return;
  }

  // Send message
  _context.lastMessageDate = data.message.timestamp;
  helper.emitEvent("received", node, data, config);

  node.send([null, data]);
}

async function reply(node, data, globalTypingDelay) {
  //check it's the last message
  let context = botmgr.getContext(data);

  let timestamp = data.message.timestamp;
  if (timestamp) timestamp = new Date(timestamp).valueOf();

  let timeContext = context.lastMessageDate;
  if (timeContext) timeContext = new Date(timeContext).valueOf();
  if (timestamp && timestamp !== timeContext) return false;

  // Assume we send the message to the current user address
  let address = botmgr.getUserAddress(data);
  if (!address || address.carrier !== "botbuilder") return false;

  // Building the message
  let message = {};
  let callback = () => {
    try {
      helper.fireAsyncCallback(data);
    }
    catch(err) {
      console.log("[BotBuilder]", err);
    };
  }

  if (data.customReply) {
    message = data.customReply;
    message.address = address;
    message.data = {
      type: message.type
    };
  } 
  else if (data.reply.length === 0) {
    return callback();
  } 
  else {
    message = getMessage(
      node,
      address,
      data.reply,
      globalTypingDelay,
      timestamp == undefined
    );
    if (!message) return false;
    message.address = address;
    if (data.metadata) message.data.value = data.metadata;
  }

  let reference = context.convRef;
  await adapter.continueConversation(reference, async (_cont) => {
    await _cont.sendActivities(message);
  })

  return callback();
}

async function sendWelcomeMessage(node, context, resolve, reject, next) {
  let data = buildMessageFlow(context.activity);
  data.message = {};

  let ref = TurnContext.getConversationReference(context.activity);
  let _context = botmgr.getContext(data);
  _context.convRef = ref;
  _context.next = next;

  resolve();
  node.send([data, null]);
}