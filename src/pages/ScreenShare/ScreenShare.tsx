import { useEffect, useState, useRef, memo } from "react"
import { useConnectionStore } from "../../store/ConnectionStore"
import { useParams } from 'react-router-dom'
import { useLocalStore } from "../../store/LocalStore"
import { useConferenceStore, VideoTrack } from "../../store/ConferenceStore"
import React from "react"
import { ErrorHandler } from "../../components/common/Info/ErrorHandler"
import styled from "styled-components"

type JitsiInitState = "INIT" | "CREATING" | "READY"

const JitsiInitMgr = () => {
  const [state, setState] = useState<JitsiInitState>("INIT");
  const initJitsiMeet = useConnectionStore(store => store.initJitsiMeet)
  const jsMeet = useConnectionStore(store => store.jsMeet);
  const connect = async () => {
    if(state === "INIT"){
      setState("CREATING");
      initJitsiMeet();
    }
  }

  useEffect(() => {
    if(jsMeet){
      setState("READY");
    }
  }, [jsMeet]);

  return {
    state,
    connect,
  }
}

type ConnectionState = "INIT" | "CREATING" | "READY"

export const ConnectionMgr = (id) => {
  const [state, setState] = useState<ConnectionState>("INIT");
  const connConnectServer = useConnectionStore(store => store.connectServer)
  const connIsConnected = useConnectionStore(store => store.connected)

  const connect = () => {
    setState("CREATING")
    connConnectServer(id);
  }

  useEffect(() => {
    if(connIsConnected){
      setState("READY");
    }
    else{
      setState("INIT");
    }
  }, [connIsConnected])

  return {
    state,
    connect,
  }
}

type TrackState = "INIT" | "CREATING" | "READY" | "DISPOSING" | "STOPPED"

export const TrackMgr = () => {
  const [state, setState] = useState<TrackState>("INIT");
  const jsMeet = useConnectionStore(store => store.jsMeet)
  const setLocalTracks = useLocalStore(store => store.setLocalTracks)
  const videoTrack = useLocalStore(store => store.video)

  const create = () => {
    if(state === "READY" || state === "CREATING" || state === "DISPOSING") return;

    console.log("trackMgr.state => CREATING")

    const meet = jsMeet;
    if(meet == null) return;
    setState("CREATING")
    meet
      .createLocalTracks({ devices: ['desktop'] }, true)
      .then(tracks => {
        console.log("trackMgr.state => READY")
        setState("READY")
        for(const t of tracks){
          // set desired state to INIT, when screensharing is stopped via browser ui button "stop sharing"
          t.addEventListener(meet.events.track.LOCAL_TRACK_STOPPED, () => {
            console.log("trackMgr.state => STOPPED")
            setState("STOPPED");
          })
        }
        setLocalTracks(tracks)
      })
      .catch((error) => {
        console.log("trackMgr.state => STOPPED")
        setState("STOPPED");
      });
  }

  const reset = () => {
    console.log("trackMgr.state => DISPOSING")
    setState("DISPOSING");
    if(state === "READY") {
      videoTrack?.dispose().then(() => {
        console.log("trackMgr.state => INIT")
        setState("INIT")
      });
    }
    else {
      console.log("trackMgr.state => INIT")
      setState("INIT");
    }
  }

  return {
    state,
    create,
    reset,
  }
}

type ConferenceState = "INIT" | "JOINING" | "READY"

export const ConferenceMgr = (id) => {
  const [state, setState] = useState<ConferenceState>("INIT");

  const initConference = useConferenceStore(store => store.init);
  const leaveConference = useConferenceStore(state => state.leave);
  const isJoined = useConferenceStore(store => store.isJoined);

  const join = () => {
    if(!isJoined){
      initConference(id);
      setState("JOINING");
    }
  }

  const reset = () => {
    if(state === "READY" && isJoined){
      // causes isJoined to transition to false, which triggers useEffect below to reset the state
      leaveConference();
    }
  }

  useEffect(() => {
    setState(isJoined ? "READY": "INIT");
  }, [isJoined])

  return {
    state,
    join,
    reset,
  }
}

type LinkState = "INIT" | "LINKED" | "LEFT"

export const LinkMgr = (linkPrimary) => {
  const [state, setState] = useState<LinkState>("INIT");
  const conference = useConferenceStore(state => state.conferenceObject)
  const jsMeet = useConnectionStore(store => store.jsMeet)

  const link = () => {
    conference?.sendCommand('link', { value: JSON.stringify({ id: conference.myUserId(), main: linkPrimary }) })
    conference?.on(jsMeet?.events.conference.USER_LEFT, idLeft => {
      if (conference?.isJoined() && idLeft === linkPrimary) {
        setState("LEFT");
      }
    })
    setState("LINKED");
  }

  const reset = () => {
    setState("INIT");
  }

  return {
    state,
    link,
    reset,
  }
}

const Video = styled.video`
  width: 100%;
  height: 100%;
  object-position: 50% 50%;
  display: block;
`

const ScreenShareVideo: React.FC<{ track: VideoTrack }> = memo(({ track }) => {
  const myRef: any = useRef()
  const room = useConferenceStore(store => store.conferenceObject)

  useEffect(() => {
    const el = myRef.current
    if (track?.containers?.length === 0) track.attach(el)
    return (() => {
      track.detach(el)
    })
  }, [track])

  useEffect(() => {
    room?.addTrack(track)
      .catch(error => { });//the track might have been added already, handle the promise error
  }, [room, track])

  return (
    <Video autoPlay={true} ref={myRef} className={`localTrack videoTrack`} />
  )
});

export const ScreenShare = () => {
  type DesiredConnectionState = "INIT" | "SHARE"
  let { id, linkPrimary } = useParams()

  const [desiredConnectionState, setDesiredConnectionState] = useState<DesiredConnectionState>("SHARE");
  const [reshare, setReshare] = useState<Boolean>(false);

  const videoTrack = useLocalStore((store) => store.video)

  const jitsiInitMgr = JitsiInitMgr();
  const connectionMgr = ConnectionMgr(id);
  const trackMgr = TrackMgr();
  const conferenceMgr = ConferenceMgr(id);
  const linkMgr = LinkMgr(linkPrimary);

  useEffect(() => {
    if(jitsiInitMgr.state === "INIT"){
      jitsiInitMgr.connect();
    }
    if(jitsiInitMgr.state === "READY" && connectionMgr.state === "INIT"){
      connectionMgr.connect();
    }
  }, [connectionMgr.state, jitsiInitMgr.state, connectionMgr, jitsiInitMgr])

  useEffect(() => {
    if(connectionMgr.state !== "READY") return;

    if(desiredConnectionState === "INIT") {
      if(conferenceMgr.state === "READY") {
        console.log("conferenceMgr.reset()");
        conferenceMgr.reset();
      }
      if(conferenceMgr.state === "INIT" && ["LINKED", "LEFT"].includes(linkMgr.state)){
        console.log("linkMgr.reset()");
        linkMgr.reset();
      }
      if(linkMgr.state === "INIT" && ["READY", "STOPPED"].includes(trackMgr.state)) {
        console.log("trackMgr.reset()");
        trackMgr.reset();
      }
      if(trackMgr.state === "INIT" && reshare){
        setReshare(false);
        setDesiredConnectionState("SHARE");
      }
    } else if (desiredConnectionState === "SHARE") {
      if(trackMgr.state === "INIT"){
        console.log("trackMgr.create()");
        trackMgr.create();
      }
      if(trackMgr.state === "READY" && conferenceMgr.state === "INIT") {
        console.log("conferenceMgr.join()");
        conferenceMgr.join();
      }
      if(conferenceMgr.state === "READY" && linkMgr.state === "INIT") {
        console.log("linkMgr.link()");
        linkMgr.link();
      }
      if(linkMgr.state === "LEFT" || trackMgr.state === "STOPPED"){
        console.log("setDesiredConnectionState('INIT')");
        setDesiredConnectionState("INIT");
        setReshare(false);
      }
    }
  }, [desiredConnectionState,
      connectionMgr.state,
      trackMgr.state,
      conferenceMgr.state,
      linkMgr.state,
      conferenceMgr,
      trackMgr,
      linkMgr,
      reshare,
  ])

  const videoAvailable = () => {
    return videoTrack && !videoTrack.disposed
  }

  return (
    <React.Fragment>
      { !videoAvailable() && (
        <button onClick={() => setDesiredConnectionState("SHARE")}>start sharing</button>
      )}
      { videoAvailable() && (
        <button onClick={() => setDesiredConnectionState("INIT")}>stop sharing</button>
      )}
      { videoAvailable() && (
        <button onClick={() => {setDesiredConnectionState("INIT"); setReshare(true)}}>share something else</button>
      )}
      <ErrorHandler />

      { videoTrack && (
        <ScreenShareVideo key={videoTrack.track.id} track={videoTrack} />
      )}
    </React.Fragment>  )
}

export default ScreenShare;