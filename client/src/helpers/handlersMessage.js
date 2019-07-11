import hljs from 'highlight.js';
import { messageConfig } from '../config/message';
import { getUserAvatarUrl } from './common';
import i18n from '../i18n';
import moment from 'moment';

const _ = require('lodash');

let listMembers = [];
let subContent = {};
let roomId = '';

const insertTextToMessageArea = function(content) {
  let target = document.getElementById('msg-content');

  target.focus();
  if (document.execCommand('insertText', false, content)) {
    return;
  }

  target.setRangeText(content, target.selectionStart, target.selectionEnd, 'end');
};

const handleContentMessageWithI18n = (content) => {
  return content = ( content = ( content = (content = content.replace(new RegExp('\\[' + i18n.t('message:button.quote') + ' mid=', 'g'), '[qt][qtmeta mid='))
    .replace(new RegExp('\\[' + i18n.t('message:button.quote') + '\\]', 'g'), '[qt]'))
    .replace(new RegExp('\\[/' + i18n.t('message:button.quote') + '\\]', 'g'), '[/qt]'))
    .replace(new RegExp('\\[' + i18n.t('message:button.reply') + ' mid=', 'g'), '[rp mid=');
}

const actionFunc = {
  toMember: function(e) {
    insertTextToMessageArea('[To:' + e.target.getAttribute('data-mid') + '] ' + e.target.text + '\n');

    return false;
  },
  replyMember: function(e) {
    insertTextToMessageArea('[' + i18n.t('message:button.reply') + ' mid=' + e.target.getAttribute('data-mid') + '] ' + e.target.getAttribute('data-name') + '\n');

    return false;
  },
  quoteMessage: function(memberId, msg) {
    insertTextToMessageArea('[' + i18n.t('message:button.quote') + ' mid=' + memberId + ' time=' + new Date(msg.time).getTime() + '] ' + msg.content + '[/' + i18n.t('message:button.quote') + ']' + '\n');

    return false;
  },
  toAll: function(e) {
    insertTextToMessageArea('[toall]' + '\n');

    return false;
  },
  titleBlock: function(e) {
    insertTextToMessageArea('[title][/title]');

    return false;
  },
  codeBlock: function(e) {
    insertTextToMessageArea('[code][/code]');

    return false;
  }
  ,
  infoBlock: function(e) {
    insertTextToMessageArea('[info][/info]');

    return false;
  }
};

const getAvatarByID = (id, hasName = false) => {
  let member = listMembers.find(member => member._id == id);
  let avatar = (member && member.avatar) ? getUserAvatarUrl(member.avatar) : messageConfig.ICO_AVATAR_NOTFOUND;
  let name = hasName ? `<span class="_nameMid${id}"> ${(member && member.avatar) ? member.name : 'Loading...'}</span>` : '';

  return `<img class="_avatar" data-mid="${id}" src="${ avatar }" onError="this.onerror=null;this.src='${messageConfig.ICO_AVATAR_NOTFOUND}';" />${name}`;
};

const messageToHtml = {
  to: function(id) {
    let avatar = getAvatarByID(id);

    return `<div data-tag="[To:${id}]" class="messageBadge"><div class="chatTimeLineTo"><span>To</span>${avatar}</div></div>`;
  },
  code: function(code) {
    let codeHighlight = hljs.highlightAuto(_.unescape(code));

    return `<code class="chatCode">${codeHighlight.value}</code>`;
  },
  toall: function() {
    return (
      '<div class="messageBadge"' + messageConfig.SIGN_TO_ALL + '><div class="messageBadge__toAllBadge"><span>TO ALL</span></div></div>'
    );
  },
  reply: function(memberId) {
    let avatar = getAvatarByID(memberId);

    return `<div data-tag="[rp mid=${memberId}]" class="messageBadge"><div class="chatTimeLineTo" data-mid="${memberId}"><span class="chatTimeLineReply">&#8592; Re</span>${avatar}</div></div>`;
  },
  title: function(content) {
    return `<div><b>&#9432</b> ${content}</div>`;
  },
  qt: function(content) {
    return `<div class="chatQuote_icon">&ldquo;</div><div class="chatQuote"><div class="quoteContent">${content}</div></div>`;
  },
  qtmeta: function(id, time) {
    let avatar = getAvatarByID(id, true);

    return `<div class="chatQuote__title"><span class="piconname">${avatar}</span><time class="quoteTimeStamp chatQuote__timeStamp"><span>${moment(parseInt(time)).format(i18n.t('message:format_time'))}</span></time></div>`;
  },
  url: function(url) {
    return `<a href="${url}" target="_blank" class="url_msg">${url}</a>`;
  },
  titleInfo: function(content) {
    return `<div class="title-block"><b>&#9432</b> ${content}</div>`;
  },
  info: function(content) {
    return `<div class="info-block">${content}</div>`;
  },
  live: function(str) {
    let rid = /(?:\s+|\b)rid=([\w-]+)/.exec(str)[1];
    let liveId = /(?:\s+|\b)id=([\w-]+)/.exec(str)[1];

    return `<div class="joinLiveButton ${(rid == roomId) ? '' : 'joinLiveButton--disabled'}" data-live-id="${liveId}"><span class="joinLiveButton__iconContainer"><img class="joinLiveButton__icon" src="${messageConfig.VIDEO_CAMERA}"></span><span class="joinLiveButton__label">Join Chatwork Live</span></div>`;
  }
};

const renderMessageToHtml = {
  to: function(content) {
    let regEx = /\[to:([\w-]+)\]/gi;
    let match = regEx.exec(content);

    while (match !== null) {
      content = content.replace(match[0], messageToHtml.to(match[1]));
      match = regEx.exec(content);
    }

    return content;
  },
  toall: function(content) {
    content = content.replace(/\[toall\]/gi, messageToHtml.toall());

    return content;
  },
  reply: function(content) {
    let regEx = /\[rp mid=([\w-]+).*?\]/g;
    let match = regEx.exec(content);

    while (match !== null) {
      content = content.replace(match[0], messageToHtml.reply(match[1]));
      match = regEx.exec(content);
    }

    return content;
  },
  info: function(content) {
    let infoRegEx = /(\[info\])(((?!\[(\/?info)\]).)*)(\[\/info\])/s;
    let infoMatch = infoRegEx.exec(content);
    let titleRegEx = /(\[title\])(((?!\[(\/?title)\]).)*)(\[\/title\])/s;

    while (infoMatch !== null) {
      if(titleRegEx.test(infoMatch[2])) {
        let titleMatch = titleRegEx.exec(infoMatch[2])

        content = content.replace(titleMatch[0], messageToHtml.titleInfo(titleMatch[2]));
      }
      content = content.replace(infoMatch[0], messageToHtml.info(infoMatch[2]));
      infoMatch = infoRegEx.exec(content);
    }

    return content;
  },
  title: function(content) {
    let regEx = /(\[title\])(((?!\[(\/?title)\]).)*)(\[\/title\])/s;
    let match = regEx.exec(content);

    while (match !== null) {
      content = content.replace(match[0], messageToHtml.title(match[2]));
      match = regEx.exec(content);
    }

    return content;
  },
  qt: function(content) {
    let regEx = /\[qt\](((?!\[(\/?qt)\]).)*)\[\/qt\]/s;
    let subRegEx = /\[qtmeta mid=([\w-]+).*?\]/g
    let match = regEx.exec(content);

    while (match !== null) {
      let key = `flag_${Math.random().toString(36).substring(2, 35)}${new Date().getTime()}`;
      content = content.replace(match[0], key);

      let subMatch = subRegEx.exec(match[1]);

      while (subMatch !== null) {
        let timeMatch =  /time=([0-9]+).*?/.exec(subMatch[0]);
        let time = (timeMatch == null) ? null : timeMatch[1];
        match[1] = match[1].replace(subMatch[0], messageToHtml.qtmeta(subMatch[1], time));
        subMatch = subRegEx.exec(match[1]);
      }

      content = content.replace(key, messageToHtml.qt(match[1]));
      match = regEx.exec(content);
    }

    return content;
  },
  url: function(content) {
    let regEx = /(http(s)?:\/\/)[\w.-]+(?:\.[\w\.-]+)+[\w\-\._~:/?#[\]@!\$&'\(\)\*\+,;=.]+/gm;
    content = content.replace(regEx, messageToHtml.url('$&'));

    return content;
  },
  live: function(content) {
    let regEx = /\[live (id=([\w-]+)\s+rid=([\w-]+)|rid=([\w-]+)\s+id=([\w-]+)).*?\]/gi;
    let match = regEx.exec(content);

    while (match !== null) {
      content = content.replace(match[0], messageToHtml.live(match[1]));
      match = regEx.exec(content);
    }

    return content;
  }
};

// handles blockCode
const renderBlockCode = content => {
  let blockCode = content;
  let regEx = /(\[code\])([\s\S]*?)(\[\/code\])/gi;
  let match = regEx.exec(content);

  while (match !== null) {
    blockCode = blockCode.replace(match[0], messageToHtml.code(match[2]));
    match = regEx.exec(content);
  }

  return blockCode;
};

// pre-handling blockCode
const handleBlockCode = content => {
  let regEx = /\[code\][\s\S]*?\[\/code\]/gm;
  let match = regEx.exec(content);
  let tmpContent = content;

  while (match !== null) {
    let key = `%_${Math.random().toString(36).substring(2, 35)}${new Date().getTime()}_%`;
    let blockCode = renderBlockCode(match[0]); // handle blockCode
    subContent[key] = blockCode;

    tmpContent = tmpContent.replace(match[0], key);
    match = regEx.exec(content);
  }

  return tmpContent;
};

const renderMessage = (message, members, roomID) => {
  let content = message.content;

  if (message.is_notification) {
    return `<div class="msg-notification"> ${content} </div>`;
  }

  listMembers = members;
  roomId = roomID;
  content = _.escape(handleBlockCode(content));

  for (let key in renderMessageToHtml) {
    content = renderMessageToHtml[key](content);
  }

  for (let key in subContent) {
    content = content.replace(key, subContent[key]);
  }

  return content;
};

export default {
  handleContentMessageWithI18n,
  renderMessage,
  actionFunc,
};
