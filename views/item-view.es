import { getShipName } from './utils'
import { join } from 'path'
import React, { Component } from 'react'
const { ROOT, $slotitems } = window
import { SlotitemIcon } from 'views/components/etc/icon'


export default class ItemView extends Component {
  render() {
    let {item, extra, label, warn} = this.props
    if (! item) {
      return <div />
    }
    let raw = item
    let mst = $slotitems[item.api_slotitem_id] || {}
    let data = Object.assign(Object.clone(mst), raw)

    return (
        <div className='item-info'>
          <span className='item-icon prophet-icon'>
            <SlotitemIcon slotitemId={data.api_type[3]}/>
            {(label != null && (extra || [6, 7, 8, 9, 10, 21, 22, 33, 37, 38].includes(data.api_type[3]))) ? (
              <span className={`number ${warn ? 'text-warning' : ''}`}>{label}</span>
            ) : null}
          </span>
          <span className='item-name'>
            {`${getShipName(data)}`}
          </span>
          <span className='item-attr'>
            <span className="alv prophet-icon">
            {
              (data.api_alv && data.api_alv >= 1 && data.api_alv <= 7) &&
              <img className='alv-img'
                src={join(ROOT, 'assets', 'img', 'airplane', `alv${data.api_alv}.png`)}
              />
            }
            </span>
            <span className="level">{data.api_level > 0 ? `★${data.api_level}` : ''}</span>
          </span>
        </div>
    )
  }
}