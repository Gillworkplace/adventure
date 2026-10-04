#pragma once
#include "core.hpp"
#include <unordered_map>
#include <stdexcept>
#include <limits>
struct Codec {
 int idmap[31]={},representative[23]={},types[23]={},capacity[23]={},stride[23]={},K=0,comb[28][7]={};
 Codec(){for(int id=1;id<=30;id++){int c=1;for(;c<=K;c++)if(CTYPE[representative[c]]==CTYPE[id]&&CVAL[representative[c]]==CVAL[id])break;if(c>K){K=c;representative[c]=id;types[c]=CTYPE[id];}idmap[id]=c;capacity[c]++;}int x=1;for(int c=1;c<=K;c++){stride[c]=x;x*=capacity[c]+1;}if(K!=22||x!=107495424)throw std::runtime_error("unexpected card classes");for(int i=0;i<28;i++){comb[i][0]=1;for(int j=1;j<=6;j++)comb[i][j]=i?comb[i-1][j-1]+comb[i-1][j]:0;}}
 int rank(const int*c,int n)const{if(!n)return 0;int ans=comb[22+n-1][n-1],prev=1;for(int i=0;i<n;i++){int r=n-i;ans+=comb[22-prev+r][r]-comb[22-c[i]+r][r];prev=c[i];}return ans;}
 int hand(const State&s,int skip=-1)const{int c[5],n=0;for(int i=0;i<s.n;i++)if(i!=skip)c[n++]=idmap[s.h[i]];std::sort(c,c+n);return rank(c,n);}
 uint32_t deckCode(uint32_t deck)const{uint32_t d=0;while(deck){int bit=__builtin_ctz(deck);deck&=deck-1;d+=stride[idmap[bit+1]];}return d;}
 uint64_t key(const State&s)const{return uint64_t(s.p)|(uint64_t(100-s.t)<<12)|(uint64_t(s.b)<<19)|(uint64_t(hand(s))<<20)|(uint64_t(deckCode(s.deck))<<37);}
};
struct KeyHash{size_t operator()(uint64_t x)const{x=(x^(x>>30))*0xbf58476d1ce4e5b9ULL;x=(x^(x>>27))*0x94d049bb133111ebULL;return x^(x>>31);}};
struct ExactEndgame {
 struct Entry{double value;int effect;};struct Exhausted{};
 Codec codec;std::unordered_map<uint64_t,Entry,KeyHash>memo;
 int maxPaid=1;size_t maxNew=50000,maxCache=250000,left=0;
 uint64_t expanded=0,solved=0,failed=0,lookups=0;
 explicit ExactEndgame(int r=1,size_t nb=50000,size_t mc=250000):maxPaid(r),maxNew(nb),maxCache(mc){memo.reserve(std::min(size_t(65536),mc));}
 void reset(){memo.clear();}
 double landed(State&s,int code){s.p=code&4095;if(s.terminal())return s.p;
  if((code&4096)&&s.n<5){int oldn=s.n;auto deck=s.deck;int count[23]={},bitFor[23]={};uint32_t bits=deck;
   while(bits){int bit=__builtin_ctz(bits);bits&=bits-1;int c=codec.idmap[bit+1];count[c]++;bitFor[c]=bit;}
   double sum=0;int nn=__builtin_popcount(deck);
   for(int c=1;c<=22;c++)if(count[c]){int bit=bitFor[c];s.h[oldn]=bit+1;s.n=oldn+1;s.deck=deck&~(1u<<bit);if(!s.deck)s.deck=0x3fffffff;sum+=count[c]*solve(s).value;}
   s.n=oldn;s.deck=deck;return sum/nn;
  }return solve(s).value;
 }
 double q(const State&s,int a){State z=s;int id=0;if(a){id=z.h[a-1];for(int i=a;i<z.n;i++)z.h[i-1]=z.h[i];--z.n;}
  if(id&&CTYPE[id]!=2)return landed(z,CTYPE[id]==3?NEXT[s.p]:LAND[s.p+CVAL[id]+3]);
  double sum=0;for(int d=2;d<=12;d++){int ways=6-abs(7-d),doubles=!s.b&&d%2==0;int code=id?LAND[s.p+CVAL[id]*d+3]:ROLL[s.p*11+d-2];
   if(ways>doubles){z.t=s.t+!s.b;z.b=0;sum+=(ways-doubles)*landed(z,code);}
   if(doubles){z.t=s.t+1;z.b=1;sum+=landed(z,code);}
  }return sum/36;
 }
 Entry solve(const State&s){if(s.terminal())return {double(s.p),0};uint64_t key=codec.key(s);lookups++;auto it=memo.find(key);if(it!=memo.end())return it->second;
  if(!left||memo.size()>=maxCache)throw Exhausted{};--left;++expanded;
  Entry best{q(s,0),0};uint32_t seen=0;for(int a=1;a<=s.n;a++){int c=codec.idmap[s.h[a-1]];if(seen&(1u<<c))continue;seen|=1u<<c;double v=q(s,a);if(v>best.value)best={v,c};}
  if(memo.size()>=maxCache)throw Exhausted{};memo.emplace(key,best);return best;
 }
 bool inspect(const State&s,int &action,double &value){if(100-s.t>maxPaid)return false;left=maxNew;
  try{auto x=solve(s);value=x.value;action=0;if(x.effect){for(int i=0;i<s.n;i++)if(codec.idmap[s.h[i]]==x.effect){action=i+1;break;}if(!action)throw std::runtime_error("effect to slot failed");}++solved;return true;}catch(const Exhausted&){++failed;return false;}
 }
};
