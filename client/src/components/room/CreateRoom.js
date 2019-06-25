import React, { PureComponent } from 'react';
import 'antd/dist/antd.css';
import FormCreateRoom from './FormCreateRoom';
import { withNamespaces } from 'react-i18next';
import { withRouter } from 'react-router';
import { Icon, Badge, Popover } from 'antd';

class CreateRoom extends PureComponent {
  constructor(props) {
    super(props);

    this.state = {
      modalVisible: false,
    };
  }

  handleModalVisible = flag => {
    this.setState({
      modalVisible: flag,
    });
  };

  render() {
    const { t } = this.props;
    const { modalVisible } = this.state;
    const parentMethods = {
      handleModalVisible: this.handleModalVisible,
    };

    const content = (
      <div>
        <p>
          <a href="javascript:;" onClick={() => this.handleModalVisible(true)}>
            <Icon type="setting" /> {t('title.create_room')}
          </a>
        </p>
      </div>
    );

    return (
      <React.Fragment>
        <Popover content={content}>
          <Badge className="header-icon" type="primary">
            <a href="javascript:;">
              <Icon type="plus-circle" />
            </a>
          </Badge>
        </Popover>
        <FormCreateRoom {...parentMethods} modalVisible={modalVisible} />
      </React.Fragment>
    );
  }
}

export default withNamespaces(['room'])(withRouter(CreateRoom));
