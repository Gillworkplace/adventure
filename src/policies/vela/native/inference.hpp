#pragma once
#include "compact.hpp"
template<class Model> struct FP{Model&M;bool deckOn;double beta=.6; double qs[6]={}; uint64_t leafcalls=0,nodes=0,refined=0,aborted=0; int mode=0; bool active=false,iid=false; int budget=0;std::unordered_map<uint64_t,double,KeyHash>cache,cacheIID;
 struct Prep{int n=0,h=0,nn=0;const int*count=nullptr;uint32_t deck=0;double deckSum=0;};
 FP(Model&m,bool on):M(m),deckOn(on){cache.reserve(4096);}
 struct Deck {uint32_t mask=0,code=0;int nn=0,count[23]={},rep[23]={};double sum=0;};
 std::vector<Deck> decks=std::vector<Deck>(1024);
 const Deck& deckInfo(uint32_t mask){
  Deck& d=decks[((mask*2654435761u)>>22)&1023];if(d.mask==mask)return d;
  d=Deck{};d.mask=mask;d.nn=__builtin_popcount(mask);uint32_t bits=mask;
  while(bits){int bit=__builtin_ctz(bits);bits&=bits-1;int c=M.codec.idmap[bit+1];d.count[c]++;d.rep[c]=bit;d.code+=M.codec.stride[c];d.sum+=DECK_COEFF[c];}
  return d;
 }
 Prep prep(const State&s,int skip,int hand){
  Prep z;z.deck=s.deck;z.n=s.n;z.h=hand;
  if(skip>=0){int c=M.codec.idmap[s.h[skip]],slot=0;for(int i=0;i<s.n;i++)slot+=M.codec.idmap[s.h[i]]<c;z.h=M.remove[hand][slot];--z.n;}
  const auto& d=deckInfo(s.deck);z.nn=d.nn;z.count=d.count;z.deckSum=deckOn?d.sum:0;
  return z;
 }
 inline double dv(const Prep&z,int r,int b,bool draw)const{if(!deckOn||(!r&&!b))return 0;int n=z.nn;double sum=z.deckSum;if(draw){if(n<=1)return 0;sum*=double(n-1)/n;n--;}return beta*std::min(1.,.7*(r+b)/n)*sum;}
 double after(const Prep&z,int r,int b,int code){int p=code&4095;if(!r&&!b)return p;bool draw=(code&4096)&&z.n<5;if(!draw)return leaf(r,b,p,z.h,z.n)+dv(z,r,b,false);double x=0;if(iid){for(int c=1;c<=22;c++)x+=M.codec.capacity[c]*leaf(r,b,p,M.add[z.h][c],z.n+1);return x/30.+dv(z,r,b,true);}for(int c=1;c<=22;c++)if(z.count[c])x+=z.count[c]*leaf(r,b,p,M.add[z.h][c],z.n+1);return x/z.nn+dv(z,r,b,true);}
 double q1(const State&s,int a,int hand){int id=a?s.h[a-1]:0;Prep z=prep(s,a-1,hand);int r=100-s.t;if(id&&CTYPE[id]!=2)return after(z,r,s.b,CTYPE[id]==3?NEXT[s.p]:LAND[s.p+CVAL[id]+3]);double sum=0;for(int d=2;d<=12;d++){int ways=6-abs(7-d),dbl=!s.b&&(d%2==0);int code=id?LAND[s.p+CVAL[id]*d+3]:ROLL[s.p*11+d-2];if(ways-dbl)sum+=(ways-dbl)*after(z,r-!s.b,0,code);if(dbl)sum+=after(z,r-1,1,code);}return sum/36.;}
 double value(const State&s){if(s.terminal())return s.p;int hand=M.codec.hand(s);uint64_t key=uint64_t(s.p)|(uint64_t(100-s.t)<<12)|(uint64_t(s.b)<<19)|(uint64_t(hand)<<20)|(uint64_t(deckInfo(s.deck).code)<<37);auto it=(iid?cacheIID:cache).find(key);if(it!=(iid?cacheIID:cache).end())return it->second;double best=-1e300;uint32_t seen=0;for(int a=0;a<=s.n;a++){int c=a?M.codec.idmap[s.h[a-1]]:0;if(seen&(1u<<c))continue;seen|=1u<<c;best=std::max(best,q1(s,a,hand));}if((iid?cacheIID:cache).size()<16384)(iid?cacheIID:cache).emplace(key,best);return best;}
 double land2(State s,int code){s.p=code&4095;if(s.terminal())return s.p;if(!(code&4096)||s.n==5)return value(s);const Deck d=deckInfo(s.deck);int nn=d.nn;double sum=0;for(int c=1;c<=22;c++)if(d.count[c]){State y=s;int bit=d.rep[c];y.h[y.n++]=bit+1;y.deck&=~(1u<<bit);if(!y.deck)y.deck=0x3fffffff;sum+=d.count[c]*value(y);}return sum/nn;}
 double q2(const State&s,int a){State z=s;int id=0;if(a){id=z.h[a-1];for(int j=a;j<z.n;j++)z.h[j-1]=z.h[j];--z.n;}int r=100-s.t;if(id&&CTYPE[id]!=2)return land2(z,CTYPE[id]==3?NEXT[s.p]:LAND[s.p+CVAL[id]+3]);double sum=0;for(int d=2;d<=12;d++){int ways=6-abs(7-d),dbl=!s.b&&(d%2==0),code=id?LAND[s.p+CVAL[id]*d+3]:ROLL[s.p*11+d-2];if(ways-dbl){State y=z;y.t=s.t+!s.b;y.b=0;sum+=(ways-dbl)*land2(y,code);}if(dbl){State y=z;y.t=s.t+1;y.b=1;sum+=land2(y,code);}}return sum/36.;}

 double leaf(int r,int b,int p,int h,int n){++leafcalls;return M.val(r,b,p,h,n);}
 int act(const State&root){if(!root.n){qs[0]=0;return 0;}State s=root;s.t=100-std::min(M.horizon(),100-root.t);cache.clear();cacheIID.clear();active=false;iid=false;double best=-1e300,second=-1e300;int ans=0;uint32_t seen=0;for(int a=0;a<=s.n;a++){int c=a?M.codec.idmap[s.h[a-1]]:0;if(seen&(1u<<c)){qs[a]=-1e300;continue;}seen|=1u<<c;double x=qs[a]=q2(s,a);if(x>best){second=best;best=x;ans=a;}else second=std::max(second,x);}
  return ans;
 }
};
