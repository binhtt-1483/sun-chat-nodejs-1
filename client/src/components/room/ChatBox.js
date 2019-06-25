import React from 'react';
import { withRouter } from 'react-router';
import { Layout, Input, Button, List, Avatar, Icon, Row, Col, Badge, Popover, message, Divider, Spin } from 'antd';
import {
  loadMessages,
  sendMessage,
  loadPrevMessages,
  loadUnreadNextMessages,
  updateMessage,
  getDirectRoomId,
} from './../../api/room.js';
import { Link } from 'react-router-dom';
import {
  addContact,
  getListSentRequestContacts,
  deleteSentRequestContact,
  acceptContact,
  rejectContact,
} from './../../api/contact';
import { SocketContext } from './../../context/SocketContext';
import { withUserContext } from './../../context/withUserContext';
import { withNamespaces } from 'react-i18next';
import moment from 'moment';
import { MESSAGE_PAGINATE, VISIABLE_MSG_TO_LOAD, LIMIT_QUANLITY_NEWEST_MSG, ROOM_TYPE } from '../../config/room';
import { messageConfig } from '../../config/messageConfig';
import InfiniteScroll from 'react-infinite-scroller';
import '../../scss/messages.scss';
import handlersMessage from '../../helpers/handlersMessage';
import { getUserAvatarUrl } from './../../helpers/common';

const { Content } = Layout;
let firstScroll = false;
let fourthMsgId = 0;
let firstPrevMsgId = 0;
let isSender = false;
let finalFooterRoom = false;

class ChatBox extends React.Component {
  static contextType = SocketContext;

  state = {
    isEditing: false,
    messages: [],
    listNewLoadedMessage: [],
    currentLastMsgId: this.props.lastMsgId,
    prevMessages: [],
    hasMsgUnRead: true,
    scrollTop: 0,
    messageIdHovering: null,
    messageIdEditing: null,
    mapUserIdRoomIds: [],
    mapUserIdSentRequest: [],
    mapUserIdRequestContact: [],
    loadingNew: false,
    isLoadingPrev: false,
    isLoadingMes: true,
    isUpdateUserInfo: false,
  };

  prevMessageRowRefs = [];
  messageRowRefs = [];
  roomRef = '';
  unReadMsg = '';
  userInfoUpdateData = {};
  socket = this.context.socket;

  fetchData(roomId) {
    loadMessages(roomId).then(res => {
      let listId = [],
        messages = res.data.messages;

      messages.map(function (item) {
        listId.push(item._id);
      });

      this.setState({
        isLoadingMes: false,
        messages: messages,
        listNewLoadedMessage: listId.reverse(),
      });

      this.checkUpdateLastMsgAndLoadNew();

      loadPrevMessages(roomId, firstPrevMsgId).then(res => {
        if (res.data.messages.length > 0) {
          firstPrevMsgId = res.data.messages[0]._id;
        }

        if (res.data.messages.length === MESSAGE_PAGINATE) {
          fourthMsgId = res.data.messages[VISIABLE_MSG_TO_LOAD]._id;
        } else {
          fourthMsgId = 0;
        }

        this.setState({
          prevMessages: res.data.messages,
        });
      });
    });
  }

  componentDidMount() {
    const roomId = this.props.roomId;
    firstPrevMsgId = 0;
    this.fetchData(roomId);

    // Listen 'send_new_msg' event from server
    this.socket.on('send_new_msg', res => {
      var { messages, listNewLoadedMessage } = this.state;
      var lastMessageId = Object.keys(this.messageRowRefs).reverse()[0];
      messages.push(res.message);
      listNewLoadedMessage.unshift(res.message._id);

      this.setState(
        {
          messages: messages,
          listNewLoadedMessage: listNewLoadedMessage,
        },
        () => {
          if (isSender || (lastMessageId && this.checkInView(this.messageRowRefs[lastMessageId]))) {
            this.updateLastMsgId([res.message._id], this.state.currentLastMsgId, 0);
            this.messageRowRefs[res.message._id].scrollIntoView();
            window.scrollTo(0, 0);
            isSender = false;
          }
        }
      );
    });

    this.socket.on('update_last_readed_message', res => {
      if (res.messageId) {
        this.setState({
          currentLastMsgId: res.messageId,
        });
      }
    });

    //Listen 'update_msg' event from server
    this.socket.on('update_msg', res => {
      const { messages, prevMessages } = this.state;
      const allMessages = messages.concat(prevMessages);

      const message = this.getMessageById(allMessages, res._id);

      if (message !== null) {
        message.content = res.content;
        this.handleCancelEdit();
      }
    });

    //Listen 'update_user_info' event from server
    this.socket.on('update_user_info', res => {
      let { messages, prevMessages } = this.state;
      this.userInfoUpdateData[res.user._id] = res.user;
      messages = this.updateMessagesByUser(prevMessages, res.user);
      prevMessages = this.updateMessagesByUser(messages, res.user);

      this.setState({ isUpdateUserInfo: true })
    });
  }

  updateMessagesByUser(messages, user) {
    if (messages.length > 1) {
      messages.forEach((message, index) => {
        if(message.user === user._id) {
          messages[index].user = user._id;
          messages[index].user_info = user;
        }
      });
    }

    return messages;
  }

  componentDidUpdate(prevProps) {
    if (prevProps.roomId !== this.props.roomId) {
      firstPrevMsgId = 0;
      document.getElementById('msg-content').value = '';
      this.fetchData(this.props.roomId);
    }

    if (!firstScroll && this.unReadMsg && (this.state.messages || this.state.prevMessages)) {
      this.unReadMsg.scrollIntoView({ block: 'start' });
      window.scroll(0, 0);
      firstScroll = true;
    }
  }

  formatMsgTime(timeInput) {
    const { t } = this.props;
    const time = new Date(timeInput);

    return moment(time).format(t('format_time'));
  }

  handleMouseEnter = e => {
    const messageIdHovering = e.currentTarget.id;
    this.setState({
      messageIdHovering,
    });
  };

  handleMouseLeave = e => {
    this.setState({
      messageIdHovering: null,
    });
  };

  getMessageById(messages, messageId) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]._id === messageId) {
        return messages[i];
      }
    }

    return null;
  }

  handleCancelEdit = () => {
    this.setState({
      isEditing: false,
      messageIdEditing: null,
    });

    document.getElementById('msg-content').value = '';
  };

  editMessage = e => {
    const messageId = e.currentTarget.id;
    const oldMsgFlag = e.currentTarget.getAttribute('old-msg-flag');

    const message = (oldMsgFlag == 1) ? this.getMessageById(this.state.prevMessages, messageId)
      : this.getMessageById(this.state.messages, messageId);

    if (message !== null) {
      this.setState({
        messageIdEditing: message._id,
        isEditing: true,
      });

      document.getElementById('msg-content').value = message.content;
    }
  };

  handleSendMessage = e => {
    const { t, roomId } = this.props;
    const messageId = this.state.messageIdEditing;

    if (e.key === undefined || (e.ctrlKey && e.keyCode == 13)) {
      let messageContent = document.getElementById('msg-content').value;

      if (messageContent.trim() !== '') {
        let data = {
          content: handlersMessage.handleContentMessageWithI18n(messageContent),
        };

        if (messageId == null) {
          isSender = true;
          sendMessage(roomId, data).catch(e => {
            message.error(t('send.failed'));
          });
        } else {
          updateMessage(roomId, messageId, data).catch(e => {
            message.error(t('edit.failed'));
          });
        }

        document.getElementById('msg-content').value = '';
      }
    }

    if (e.keyCode == 27) {
      this.handleCancelEdit();
    }
  };

  checkInView(message) {
    var roomChat = this.roomRef.getBoundingClientRect();
    message = message.getBoundingClientRect();
    var elemTop = message.top - roomChat.top;
    var elemBottom = elemTop + message.height;

    return (elemTop < 0 && elemBottom > 0) || (elemTop > 0 && elemTop <= roomChat.height);
  }

  updateLastMsgId(listNewLoadedMessage, currentLastMsgId, indexMsgBeUpdated) {
    /* when message_id need update > current last_message_id */
    if (listNewLoadedMessage[indexMsgBeUpdated] > currentLastMsgId || currentLastMsgId === null) {
      const param = {
        roomId: this.props.roomId,
        messageId: listNewLoadedMessage[indexMsgBeUpdated],
      };

      this.socket.emit('update_last_readed_message', param);
    }
  }

  checkUpdateLastMsgAndLoadNew() {
    var { listNewLoadedMessage, currentLastMsgId, messages, prevMessages, hasMsgUnRead } = this.state;
    var roomId = this.props.match.params.id,
      messageRowRefs = this.messageRowRefs,
      messageKeysRowRefs = Object.keys(messageRowRefs),
      arrCheckEnable = [],
      listNewId = [];

    /* check from newest message, stop when meet first message be displayed */
    for (let i = messageKeysRowRefs.length - 1; i >= 0; i--) {
      if (listNewLoadedMessage.indexOf(messageKeysRowRefs[i]) >= 0) {
        let status = this.checkInView(messageRowRefs[messageKeysRowRefs[i]]);
        arrCheckEnable.push(status);

        if (status) {
          break;
        }
      }
    }

    if (arrCheckEnable.length <= 1) {
      finalFooterRoom = true;
    }

    if (messages.length >= MESSAGE_PAGINATE && !this.state.loadingNew) {
      if (hasMsgUnRead && arrCheckEnable.length <= VISIABLE_MSG_TO_LOAD) {
        this.setState({ loadingNew: true });
        loadUnreadNextMessages(roomId, listNewLoadedMessage[0]).then(res => {
          this.setState({ loadingNew: false });
          let listNewMsg = res.data.messages;

          /* concat current messages and new message */
          messages = messages.concat(listNewMsg);

          if (listNewMsg.length < MESSAGE_PAGINATE) {
            this.setState({
              hasMsgUnRead: false,
            });
          }

          listNewMsg.map(function (item) {
            listNewId.push(item._id);
          });

          /* just need LIMIT_QUANLITY_NEWEST_MSG message */
          if (messages.length > LIMIT_QUANLITY_NEWEST_MSG) {
            messages = messages.slice(messages.length - LIMIT_QUANLITY_NEWEST_MSG, messages.length);
            prevMessages = [];
            firstPrevMsgId = messages[0]._id;
            fourthMsgId = messages[VISIABLE_MSG_TO_LOAD]._id;
          } else if (messages.length + prevMessages.length > LIMIT_QUANLITY_NEWEST_MSG) {
            prevMessages = prevMessages.slice(
              prevMessages.length - LIMIT_QUANLITY_NEWEST_MSG + messages.length,
              prevMessages.length
            );
            firstPrevMsgId = prevMessages[0]._id;
            fourthMsgId =
              prevMessages.length < VISIABLE_MSG_TO_LOAD
                ? messages[VISIABLE_MSG_TO_LOAD - prevMessages.length]._id
                : prevMessages[VISIABLE_MSG_TO_LOAD]._id;
          }

          this.setState({
            listNewLoadedMessage: listNewMsg ? listNewId.reverse() : listNewLoadedMessage,
            messages: messages,
          });
        });
      }
    }

    /* check the first view room || loading new message || final message */
    if (!currentLastMsgId || currentLastMsgId === this.props.lastMsgId || this.state.loadingNew || (arrCheckEnable.length === 1 && !hasMsgUnRead)) {
      this.updateLastMsgId(listNewLoadedMessage, currentLastMsgId, arrCheckEnable.length - 1);
    }
  }

  scrollDown() {
    this.checkUpdateLastMsgAndLoadNew();
  }

  scrollUp() {
    const roomId = this.props.roomId;
    let { prevMessages } = this.state;

    if (fourthMsgId !== 0) {
      let dom = this.prevMessageRowRefs[fourthMsgId].getBoundingClientRect();

      if (dom.top > 0 && this.state.isLoadingPrev === false) {
        // Call next API
        loadPrevMessages(roomId, firstPrevMsgId).then(res => {
          this.setState({ isLoadingPrev: false });

          if (Object.entries(res.data.messages[0]).length !== 0) {
            firstPrevMsgId = res.data.messages[0]._id;

            if (res.data.messages.length === MESSAGE_PAGINATE) {
              fourthMsgId = res.data.messages[VISIABLE_MSG_TO_LOAD]._id;
            } else {
              fourthMsgId = 0;
            }

            const oldMessages = res.data.messages;
            prevMessages = oldMessages.concat(prevMessages);

            this.setState({
              prevMessages: prevMessages,
            });
          }
        });

        this.setState({ isLoadingPrev: true });
      }
    }
  }

  handleScroll = e => {
    let scrollTop = e.currentTarget.scrollTop;

    if (this.state.scrollTop > scrollTop) {
      this.scrollUp();
    } else {
      this.scrollDown();
    }

    this.setState({
      scrollTop: scrollTop,
    });
  };

  handleInfiniteOnLoad = () => { };

  createMarkupMessage = (message, userInfo) => {
    const members = this.props.allMembers;
    let messageContentHtml = handlersMessage.renderMessage(message, members, userInfo);

    return { __html: messageContentHtml };
  };

  setMapUserIdRequestContact = (requestId, status = true) => {
    this.setState(prevState => ({
      mapUserIdRequestContact: {
        ...prevState.mapUserIdRequestContact,
        [requestId]: status,
      },
    }));
  }

  setMapUserIdSentRequest = (sentRequestId, status = true) => {
    this.setState(prevState => ({
      mapUserIdSentRequest: {
        ...prevState.mapUserIdSentRequest,
        [sentRequestId]: status,
      },
    }));
  }

  getDirectRoom = userId => {
    getDirectRoomId(userId).then(res => {
      let roomId = res.data;

      this.setState(prevState => ({
        mapUserIdRoomIds: {
          ...prevState.mapUserIdRoomIds,
          [userId]: roomId._id !== undefined ? roomId._id : null,
        },
      }));
    });
  }

  handleSendRequestContact = e => {
    const sendContactId = e.target.value;

    addContact({ userId: sendContactId })
      .then(res => {
        this.setMapUserIdSentRequest(sendContactId);

        message.success(res.data.success);
      })
      .catch(error => {
        message.error(error.response.data.error);
      });
  }

  handleCancelRequest = e => {
    const sentRequestId = e.target.value;

    deleteSentRequestContact({ requestSentContactId: sentRequestId })
      .then(res => {
        this.setMapUserIdSentRequest(sentRequestId, false);

        message.success(res.data.success);
      })
      .catch(error => {
        message.error(error.response.data.error);
      });
  }

  handleRejectContact = e => {
    let dataInput = {
      rejectContactIds: [e.target.value],
    };

    if (dataInput.rejectContactIds.length > 0) {
      rejectContact(dataInput)
        .then(res => {
          dataInput['rejectContactIds'].map(checkedId => {
            this.setMapUserIdRequestContact(checkedId, false);
          });

          message.success(res.data.success);
        })
        .catch(error => {
          message.error(error.response.data.error);
        });
    }
  }

  handleAcceptContact = e => {
    const requestId = [e.target.value];

    acceptContact(requestId)
      .then(res => {
        this.setMapUserIdRequestContact(requestId, false);
        this.getDirectRoom(requestId);

        message.success(res.data.success);
      })
      .catch(error => {
        message.error(error.response.data.error);
      });
  }

  handleVisibleChange = userId => visible => {
    if (visible && this.state.mapUserIdRoomIds[userId] === undefined) {
      this.getDirectRoom(userId);
    }

    if (visible) {
      getListSentRequestContacts().then(res => {
        let sentRequestIds = res.data.result;

        if (!sentRequestIds.includes(userId)) {
          sentRequestIds.map(item => {
            this.setMapUserIdSentRequest(item._id);
          });
        } else {
          this.setMapUserIdSentRequest(userId, false);
        }
      });

      let requestContactIds = this.props.userContext.info.requested_in_comming;

      if (requestContactIds.includes(userId)) {
        requestContactIds.map(item => {
          let requestContactId = Object.assign({ _id: item });

          this.setMapUserIdRequestContact(requestContactId._id);
        });
      }
    }
  };

  returnContent = message => {
    const currentUserChatRoom = this.props.userContext.my_chat_id;
    const currentuserId = this.props.userContext.info._id;
    const directRoomId = this.state.mapUserIdRoomIds[message.user_info._id];
    const userIdSentRequest = this.state.mapUserIdSentRequest[message.user_info._id];
    const userIdRequestContacts = this.state.mapUserIdRequestContact[message.user_info._id];

    let button = '';
    if (message.user_info._id == currentuserId) {
      button = (
        <Link to={`/rooms/${currentUserChatRoom}`}>
          <Button>{this.props.t('title.my_chat')}</Button>
        </Link>
      );
    } else if (directRoomId === undefined) {
      button = <Spin />;
    } else {
      button = directRoomId ? (
        <Link to={`/rooms/${directRoomId}`}>
          <Button>{this.props.t('title.direct_chat')}</Button>
        </Link>
      ) : userIdRequestContacts ? (
        <div>
          <Button value={message.user_info._id} onClick={this.handleRejectContact}>
            {this.props.t('title.reject_request')}
          </Button>
          <Button value={message.user_info._id} onClick={this.handleAcceptContact}>
            {this.props.t('title.accept_request')}
          </Button>
        </div>
      ) : userIdSentRequest ? (
        <Button value={message.user_info._id} onClick={this.handleCancelRequest}>
          {this.props.t('title.cancel_request')}
        </Button>
      ) : (
        <Button value={message.user_info._id} onClick={this.handleSendRequestContact}>
          {this.props.t('title.add_contact')}
        </Button>
      );
    }

    return (
      <div className="popover-infor">
        <div className="infor-bg">
          <Avatar src={getUserAvatarUrl(message.user_info.avatar)} className="infor-avatar" />
        </div>
        <p className="infor-name">{message.user_info.name}</p>
        <p>{message.user_info.email}</p>
        <div className="infor-footer">
          <div>{<List.Item>{button}</List.Item>}</div>
        </div>
      </div>
    );
  };

  render() {
    const {
      prevMessages,
      messages,
      currentLastMsgId,
      listNewLoadedMessage,
      isEditing,
      isLoadingMes,
      isLoadingPrev,
      loadingNew,
    } = this.state;
    const { t, roomInfo, allMembers, roomId } = this.props;
    const currentUserInfo = this.props.userContext.info;

    const showListMember =
      allMembers == [] ? (
        <span>Not data</span>
      ) : (
          <div className="member-infinite-container">
            {roomInfo.type == ROOM_TYPE.GROUP_CHAT && (
              <a className="form-control to-all" href="javascript:;" onClick={handlersMessage.actionFunc.toAll}>
                <span>{t('to_all')}</span>
              </a>
            )}
            <InfiniteScroll initialLoad={false} pageStart={0} loadMore={this.handleInfiniteOnLoad} useWindow={false}>
              <List
                dataSource={allMembers}
                renderItem={member => {
                  return member._id != currentUserInfo._id ? (
                    <List.Item key={member._id}>
                      <List.Item.Meta
                        avatar={<Avatar src={getUserAvatarUrl(member.avatar)} />}
                        title={
                          <a onClick={handlersMessage.actionFunc.toMember} href="javascript:;" data-mid={member._id}>
                            {member.name}
                          </a>
                        }
                      />
                    </List.Item>
                  ) : (
                      <span />
                    );
                }}
              />
            </InfiniteScroll>
          </div>
        );

    const redLine = (
      <div
        className={'timeLine__unreadLine ' + (loadingNew || currentLastMsgId === this.props.lastMsgId ? 'hide' : '')}
        ref={element => (this.unReadMsg = element)}
      >
        <div className="timeLine__unreadLineBorder">
          <div className="timeLine__unreadLineContainer">
            <div className="timeLine__unreadLineBody">
              <span className="timeLine__unreadLineText">{t('unread_title')}</span>
            </div>
          </div>
        </div>
      </div>
    );

    return (
      <Content className="chat-room">
        <div className="list-message" ref={element => (this.roomRef = element)} onScroll={this.handleScroll}>
          {(isLoadingPrev || isLoadingMes) && (
            <div className="loading-room">
              <Spin tip="Loading..." />
            </div>
          )}
          {prevMessages.map(message => {
            let messageHtml = this.createMarkupMessage(message, this.userInfoUpdateData)
            let notificationClass = message.is_notification ? 'pre-notification' : '';
            let isToMe = messageHtml.__html.includes(`data-cwtag="[To:${currentUserInfo._id}]"`) ||
              messageHtml.__html.includes(messageConfig.SIGN_TO_ALL);

            return (
              <div key={message._id} ref={element => (this.prevMessageRowRefs[message._id] = element)}>
                <Row
                  key={message._id}
                  className={this.state.messageIdEditing === message._id ? 'message-item isEditing' : 'message-item', isToMe ? 'timelineMessage--mention' : '' }
                  onMouseEnter={this.handleMouseEnter}
                  onMouseLeave={this.handleMouseLeave}
                  id={message._id}
                >
                  <Col span={22}>
                    <List.Item className="li-message">
                      <Popover
                        placement="topLeft"
                        trigger="click"
                        text={message.user_info.name}
                        content={this.returnContent(message)}
                        onVisibleChange={this.handleVisibleChange(message.user_info._id)}
                      >
                        <div data-user-id={message.user_info._id}>
                          <List.Item.Meta
                            className="show-infor"
                            avatar={<Avatar src={getUserAvatarUrl(message.user_info.avatar)} />}
                            title={<p>{message.user_info.name}</p>}
                          />
                        </div>
                      </Popover>
                    </List.Item>
                    <div className="infor-content">
                      <pre className={"timelineMessage__message " + notificationClass} dangerouslySetInnerHTML={messageHtml} />
                    </div>
                  </Col>
                  <Col span={2} className="message-time">
                    <h4>
                      {this.formatMsgTime(message.updatedAt)}{' '}
                      {message.updatedAt !== message.createdAt ? (
                        <span>
                          <Icon type="edit" />
                        </span>
                      ) : (
                          ''
                        )}
                    </h4>
                  </Col>
                  <Col span={24} style={{ position: 'relative' }}>
                    {this.state.messageIdHovering === message._id && message.is_notification == false &&
                      <div style={{ textAlign: 'right', position: 'absolute', bottom: '0', right: '0' }}>
                        {currentUserInfo._id === message.user_info._id &&
                          !this.props.isReadOnly && (
                            <Button type="link" onClick={this.editMessage} id={message._id} old-msg-flag="1">
                              <Icon type="edit" /> {t('button.edit')}
                            </Button>
                          )
                        }
                        <Divider type="vertical" />
                        <Button type="link"
                          onClick={handlersMessage.actionFunc.replyMember}
                          id={message._id}
                          data-rid={roomId}
                          data-mid={message.user_info._id}
                          data-name={currentUserInfo.name}
                        >
                          <Icon type="enter" /> {t('button.reply')}
                        </Button>
                        <Divider type="vertical" />
                        <Button type="link" onClick={this.quoteMessage} id={message._id}>
                          <Icon type="rollback" /> {t('button.quote')}
                        </Button>
                      </div>
                    }
                  </Col>
                </Row>
              </div>
            );
          })}
          <div ref={element => (this.roomRef = element)}>
            {messages.map(message => {
              let messageHtml = this.createMarkupMessage(message, this.userInfoUpdateData)
              let notificationClass = message.is_notification ? 'pre-notification' : '';
              let isToMe = messageHtml.__html.includes(`data-cwtag="[To:${currentUserInfo._id}]"`) ||
                messageHtml.__html.includes(messageConfig.SIGN_TO_ALL);

              return (
                <div
                  key={message._id}
                  ref={element => (this.messageRowRefs[message._id] = element)}
                  className="wrap-message"
                >
                  <Row
                    key={message._id}
                    className={
                      (this.state.messageIdEditing === message._id ? 'message-item isEditing' : 'message-item',
                        isToMe ? 'timelineMessage--mention' : '')
                    }
                    onMouseEnter={this.handleMouseEnter}
                    onMouseLeave={this.handleMouseLeave}
                    id={message._id}
                  >
                    <Col span={22}>
                      <List.Item className="li-message">
                        <Popover
                          placement="topLeft"
                          trigger="click"
                          text={message.user_info.name}
                          content={this.returnContent(message)}
                          onVisibleChange={this.handleVisibleChange(message.user_info._id)}
                        >
                          <div data-user-id={message.user_info._id}>
                            <List.Item.Meta
                              className="show-infor"
                              avatar={<Avatar src={getUserAvatarUrl(message.user_info.avatar)} />}
                              title={<p>{message.user_info.name}</p>}
                            />
                          </div>
                        </Popover>
                      </List.Item>
                      <div className="infor-content">
                        <pre className={"timelineMessage__message " + notificationClass} dangerouslySetInnerHTML={messageHtml} />
                      </div>
                    </Col>
                    <Col span={2} className="message-time">
                      <h4>
                        {this.formatMsgTime(message.updatedAt)}{' '}
                        {message.updatedAt !== message.createdAt ? (
                          <span>
                            <Icon type="edit" />
                          </span>
                        ) : (
                            ''
                          )}
                      </h4>
                    </Col>
                    <Col span={24} style={{ position: 'relative' }}>
                      {this.state.messageIdHovering === message._id && message.is_notification == false &&
                        <div style={{ textAlign: 'right', position: 'absolute', bottom: '0', right: '0' }}>
                          {currentUserInfo._id === message.user_info._id &&
                            !this.props.isReadOnly && (
                              <Button type="link" onClick={this.editMessage} id={message._id}>
                                <Icon type="edit" /> {t('button.edit')}
                              </Button>
                            )
                          }
                          <Divider type="vertical" />
                          <Button type="link"
                            onClick={handlersMessage.actionFunc.replyMember}
                            id={message._id}
                            data-rid={roomId}
                            data-mid={message.user_info._id}
                            data-name={currentUserInfo.name}
                          >
                            <Icon type="enter" /> {t('button.reply')}
                          </Button>
                          <Divider type="vertical" />
                          <Button type="link" onClick={this.quoteMessage} id={message._id}>
                            <Icon type="rollback" /> {t('button.quote')}
                          </Button>
                        </div>
                      }
                    </Col>
                  </Row>
                  {!finalFooterRoom && message._id === currentLastMsgId && currentLastMsgId !== listNewLoadedMessage[0] ? redLine : ''}
                </div>
              );
            })}
            {loadingNew && (
            <div className="loading-room">
              <Spin tip="Loading..." />
            </div>
            )}
          </div>
        </div>
        <div className="box-button">
          <Popover content={showListMember}>
            <Badge className="header-icon" type="primary">
              <a href="javascript:;">
                <strong>{t('to')}</strong>
              </a>
            </Badge>
          </Popover>
          {isEditing ? (
            <React.Fragment>
              <Button style={{ float: 'right' }} type="primary" onClick={this.handleSendMessage}>
                {t('button.update')}
              </Button>
              <Button style={{ float: 'right' }} type="default" onClick={this.handleCancelEdit}>
                {t('button.cancel')}
              </Button>
            </React.Fragment>
          ) : (
              <React.Fragment>
                <Button
                  style={{ float: 'right' }}
                  type="primary"
                  onClick={this.handleSendMessage}
                  disabled={this.props.isReadOnly}
                >
                  {t('button.send')}
                </Button>
              </React.Fragment>
            )}
        </div>
        <Input.TextArea
          placeholder={t('type_msg')}
          rows={4}
          style={{ resize: 'none' }}
          id="msg-content"
          disabled={this.props.isReadOnly}
          onKeyDown={this.handleSendMessage}
        />
      </Content>
    );
  }
}

export default withRouter(withNamespaces(['message'])(withUserContext(ChatBox)));
