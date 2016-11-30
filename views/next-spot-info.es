const __ = window.i18n["poi-plugin-prophet"].__.bind(window.i18n["poi-plugin-prophet"])

import React, { Component, PropTypes } from 'react'
import { connect } from 'react-redux'
import _ from 'lodash'
import { createSelector } from 'reselect'
import { extensionSelectorFactory } from 'views/utils/selectors'
import { resolve } from 'path'

const getCompassAngle = (mapspot, sortieMapId, lastSpot, nextSpot) =>{
  if (lastSpot == nextSpot || nextSpot == -1) return NaN
  const mapspots = _.get(mapspot, [Math.floor(sortieMapId / 10), sortieMapId % 10], [])
  if (!mapspots || !Object.keys(mapspots).length) return NaN
  let last = mapspots[lastSpot]
  let next = mapspots[nextSpot]
  if (!last || !next || !Object.keys(last).length || !Object.keys(next).length) return NaN

  return Math.atan2(next[1]-last[1], next[0] - last[0]) / Math.PI * 180 + 90
}

const sortieDataSelector = (state) => {
  const {sortie} = state
  const {currentNode, bossNode, spotHistory, sortieMapId} = sortie
  const lastSpot = _.takeRight(spotHistory,2)[0]
  return({
    lastSpot,
    nextSpot: currentNode || -1,
    bossNode,
    sortieMapId: parseInt(sortieMapId),
  })
}

const mapSpotSelector = createSelector(
  [extensionSelectorFactory('poi-plugin-prophet')],
  (state) => ({mapspot: (state.mapspot || {}) })
)




const NextSpotInfo = connect(
  (state) => ({
    ...sortieDataSelector(state),
    ...mapSpotSelector(state),
  })
)(class NextSpotInfo extends Component {
  static propTypes = {
    lastSpot: PropTypes.number.isRequired,
    nextSpot: PropTypes.number.isRequired,
    bossNode: PropTypes.number.isRequired,
    sortieMapId: PropTypes.number.isRequired,
    spotKind: PropTypes.string.isRequired,
    mapspot: PropTypes.object.isRequired,
  }

  static defaultProps = {
    lastSpot: 0,
    nextSpot: 0,
    bossNode: 0,
    sortieMapId: 0,
    spotKind: '',
    mapspot: {},
  }

  render() {
    const {lastSpot, nextSpot, sortieMapId, mapspot, spotKind} = this.props
    let compassAngle = getCompassAngle(mapspot, sortieMapId, lastSpot, nextSpot)
    // svg arrow's default angle is 135 deg
    return(
      <span className='next-spot-info'>
        {`${__("Compass Point")}: `}
        <span className="compass">
        {
          Number.isNaN(compassAngle) ?
          '?' :
          <span className="prophet-icon svg" id="prophet-compass">
            <img src={resolve(__dirname, `../assets/compass-arrow-${window.isDarkTheme? 'dark' : 'light'}.svg`)}
              style={{'transform': `rotate(${compassAngle - 135}deg)`}} className="svg">
            </img>
          </span>
          }
          </span>

          {` | ${nextSpot}: ${__(spotKind)}`}
      </span>
    )
  }
})

export default NextSpotInfo