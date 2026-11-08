/**
 * HRSSiteConfig —— Boss直聘 / 猎聘 站点选择器与动作配置
 * v1.1.0：选择器只服务于「我的沟通」会话；推荐牛人页不再参与扫描。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.HRSSiteConfig = factory();
})(this, function () {
  'use strict';

  var CONFIG = {
    boss: {
      name: 'Boss直聘',
      communicationPath: '/web/chat/index',
      conversationSelectors: [
        'li.geek-item',
        '.geek-item',
        'li[class*="chat-item"]',
        '[class*="chat-user-item"]',
        'li[class*="chat-list-item"]',
        '[class*="message-item"]',
        '[class*="conversation-item"]',
        'ul[class*="user-list"] > li[data-id]',
        'ul[class*="chat"] > li[data-id]'
      ],
      activeConversationSelectors: [
        'li.geek-item.active',
        'li.geek-item[class*="active"]',
        '[class*="chat-list-item"].active',
        '[class*="message-item"].active',
        '[class*="chat-item"].active',
        '[class*="conversation-item"].active',
        'li[data-id][aria-selected="true"]',
        'li.geek-item.selected',
        '[class*="geek-item"][class*="selected"]',
        '[class*="chat-item"][class*="selected"]',
        '[class*="conversation-item"][class*="selected"]'
      ],
      nameSelectors: ['.geek-name', '.user-name', '.name', '[class*="name"]'],
      jobSelectors: ['.geek-job', '.job-name', '.position-name', '[class*="job-name"]', '[class*="position"]'],
chatPanelSelectors: ['.chat-content', '.message-content', '.chat-message-list', '.message-list', '.chat-conversation', '.dialog-wrap', '.chat-container', '[class*="chat-conversation"]', '[class*="message-list"]', '[class*="chat-main"]'],
      chatTitleSelectors: ['.chat-title', '.message-header [class*="name"]', '[class*="conversation-header"] [class*="name"]', '.base-info [class*="name"]', '[class*="base-info"] [class*="name"]', '.name-box', '[class*="geek-info"] [class*="name"]', '[class*="chat-header"] [class*="name"]'],
      inputSelectors: ['#chat-input', 'textarea[placeholder]', 'textarea', 'div[contenteditable="true"]', '[role="textbox"]'],
      sendSelectors: ['button[class*="send"]', '.submit', '[class*="btn-send"]', 'button[type="submit"]'],
      requestResumeSelectors: ['button[class*="resume"]', '[class*="resume"] button', '[role="button"][class*="resume"]'],
      attachmentSelectors: ['a[href*=".pdf"]', 'a[download]', '[data-url*=".pdf"]', '[data-file-url]', '[class*="file-item"] a', '[class*="resume-file"] a'],
      markReadSelectors: ['[class*="read"]:has-text("已读")', 'button:has-text("标记已读")'],
      autoMarkReadOnOpen: true
    },
    liepin: {
      name: '猎聘',
      communicationPath: '/chat',
      conversationSelectors: [
        '[class*="chat-item"]',
        '[class*="conversation-item"]',
        '[class*="message-item"]',
        'li[data-conversation-id]',
        'li[data-chat-id]',
        'li[data-id][class*="chat"]'
      ],
      activeConversationSelectors: [
        '[class*="chat-item"].active',
        '[class*="conversation-item"].active',
        '[class*="message-item"].active',
        'li[aria-selected="true"]'
      ],
      nameSelectors: ['.name', '.user-name', '[class*="user-name"]', '[class*="nickname"]'],
      jobSelectors: ['.job-title', '.position-name', '[class*="job-title"]', '[class*="position"]'],
chatPanelSelectors: ['.chat-container', '.im-panel', '.chat-content', '.message-content', '.message-list', '.chat-conversation', '[class*="chat-content"]', '[class*="conversation-content"]', '[class*="message-list"]'],
      chatTitleSelectors: ['.chat-title', '[class*="conversation-header"] [class*="name"]', '.message-header [class*="name"]'],
      inputSelectors: ['textarea[placeholder]', 'textarea', 'div[contenteditable="true"]', '[role="textbox"]'],
      sendSelectors: ['button[class*="send"]', '[class*="btn-send"]', 'button[type="submit"]'],
      requestResumeSelectors: ['button[class*="resume"]', '[class*="resume"] button', '[role="button"][class*="resume"]'],
      attachmentSelectors: ['a[href*=".pdf"]', 'a[download]', '[data-url*=".pdf"]', '[data-file-url]', '[class*="file-item"] a', '[class*="resume-file"] a'],
      markReadSelectors: ['[class*="read"]:has-text("已读")', 'button:has-text("标记已读")'],
      autoMarkReadOnOpen: true
    }
  };

  function get(site) { return CONFIG[site] || null; }
  function set(site, cfg) { if (CONFIG[site] && cfg) CONFIG[site] = cfg; return CONFIG[site]; }
  function defaults() { return JSON.parse(JSON.stringify(CONFIG)); }

  return { get: get, set: set, defaults: defaults, CONFIG: CONFIG };
});
